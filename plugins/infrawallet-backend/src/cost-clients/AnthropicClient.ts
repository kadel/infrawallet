import { CacheService, DatabaseService, LoggerService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { CLOUD_PROVIDER, PROVIDER_TYPE } from '../service/consts';
import { getBillingPeriod, parseCost } from '../service/functions';
import { CostQuery, Report } from '../service/types';
import { InfraWalletClient } from './InfraWalletClient';
import { AnthropicCostReportResponseSchema } from '../schemas/AnthropicBilling';
import { ZodError } from 'zod';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_API_VERSION = '2023-06-01';
const MAX_DAILY_BUCKETS = 31;

export class AnthropicClient extends InfraWalletClient {
  static create(config: Config, database: DatabaseService, cache: CacheService, logger: LoggerService) {
    return new AnthropicClient(CLOUD_PROVIDER.ANTHROPIC, config, database, cache, logger);
  }

  protected async initCloudClient(_integrationConfig: Config): Promise<any> {
    return null;
  }

  protected async fetchCosts(integrationConfig: Config, _client: any, query: CostQuery): Promise<any> {
    const apiKey = integrationConfig.getString('apiKey');

    const startDate = new Date(Number(query.startTime));
    const endDate = new Date(Number(query.endTime));

    const allBuckets: any[] = [];

    // Split into <=31-day windows due to API limit
    let windowStart = new Date(startDate);
    while (windowStart < endDate) {
      const windowEnd = new Date(windowStart);
      windowEnd.setUTCDate(windowEnd.getUTCDate() + MAX_DAILY_BUCKETS);
      if (windowEnd > endDate) {
        windowEnd.setTime(endDate.getTime());
      }

      const startingAt = windowStart.toISOString();
      const endingAt = windowEnd.toISOString();

      let page: string | null = null;
      let hasMore = true;

      while (hasMore) {
        const params = new URLSearchParams({
          starting_at: startingAt,
          ending_at: endingAt,
          bucket_width: '1d',
        });
        params.append('group_by[]', 'description');

        if (page) {
          params.set('page', page);
        }

        const url = `${ANTHROPIC_API_BASE}/v1/organizations/cost_report?${params.toString()}`;
        this.logger.info(`Fetching Anthropic costs from ${startingAt} to ${endingAt}`);

        const response = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          this.logger.error(`Failed to fetch Anthropic costs: ${response.status} ${response.statusText}`);
          break;
        }

        const data = await response.json();

        try {
          AnthropicCostReportResponseSchema.parse(data);
          this.logger.debug('Anthropic cost response validation passed');
        } catch (error) {
          if (error instanceof ZodError) {
            this.logger.warn(`Anthropic cost response validation failed: ${error.message}`);
            this.logger.debug(`Sample validation errors: ${JSON.stringify(error.errors.slice(0, 3))}`);
          } else {
            this.logger.warn(`Unexpected validation error: ${(error as Error).message}`);
          }
        }

        if (data.data) {
          allBuckets.push(...data.data);
        }

        hasMore = data.has_more === true;
        page = data.next_page || null;
      }

      windowStart = new Date(windowEnd);
    }

    return allBuckets;
  }

  protected async transformCostsData(
    integrationConfig: Config,
    query: CostQuery,
    costResponse: any,
  ): Promise<Report[]> {
    const integrationName = integrationConfig.getString('name');
    const tags = integrationConfig.getOptionalStringArray('tags');
    const tagKeyValues: { [key: string]: string } = {};
    tags?.forEach(tag => {
      const [k, v] = tag.split(':');
      tagKeyValues[k.trim()] = v.trim();
    });

    let processedRecords = 0;
    let filteredOutZeroAmount = 0;
    let filteredOutMissingFields = 0;
    let filteredOutInvalidDate = 0;
    const filteredOutTimeRange = 0;
    const uniqueKeys = new Set<string>();
    const totalRecords = costResponse?.length || 0;

    const transformedData: { [key: string]: Report } = {};

    for (const bucket of costResponse) {
      const bucketDate = bucket.starting_at;
      if (!bucketDate) {
        filteredOutInvalidDate++;
        continue;
      }

      const period = getBillingPeriod(query.granularity, bucketDate, 'YYYY-MM-DDTHH:mm:ssZ');

      if (!bucket.results || !Array.isArray(bucket.results)) {
        continue;
      }

      for (const item of bucket.results) {
        const description = item.description;
        const costAmount = item.amount;

        if (costAmount === undefined || costAmount === null) {
          filteredOutMissingFields++;
          continue;
        }

        // Amount is in cents as a decimal string, convert to dollars
        const amount = parseCost(Number(costAmount) / 100);
        if (amount === 0) {
          filteredOutZeroAmount++;
          continue;
        }

        const serviceName = item.model || description || 'Other';
        const account = integrationName;

        if (!this.evaluateIntegrationFilters(account, integrationConfig)) {
          continue;
        }

        const keyName = `${this.provider}/${account}/${serviceName}`;

        if (!transformedData[keyName]) {
          uniqueKeys.add(keyName);
          transformedData[keyName] = {
            id: keyName,
            account: `${this.provider}/${account}`,
            service: this.convertServiceName(serviceName),
            category: 'AI Services',
            provider: this.provider,
            providerType: PROVIDER_TYPE.INTEGRATION,
            reports: {},
            ...tagKeyValues,
          };
        }

        // Sum costs for the same period (daily → monthly aggregation)
        transformedData[keyName].reports[period] = (transformedData[keyName].reports[period] || 0) + amount;
        processedRecords++;
      }
    }

    this.logTransformationSummary({
      processed: processedRecords,
      uniqueReports: uniqueKeys.size,
      zeroAmount: filteredOutZeroAmount,
      missingFields: filteredOutMissingFields,
      invalidDate: filteredOutInvalidDate,
      timeRange: filteredOutTimeRange,
      totalRecords,
    });

    return Object.values(transformedData);
  }
}
