# Anthropic

To manage Anthropic API costs, you need an Admin API key (`sk-ant-admin...`) from your organization. Only organization members with the admin role can provision Admin API keys through the [Anthropic Console](https://console.anthropic.com/settings/admin-keys). The Admin API is unavailable for individual accounts.

For more details, see the [Anthropic Usage & Cost API documentation](https://docs.anthropic.com/en/docs/build-with-claude/usage-cost-api).

Add the following settings to `app-config.yaml`:

```yaml
backend:
  infraWallet:
    integrations:
      anthropic:
        - name: <unique_name_of_this_integration>
          apiKey: <your_anthropic_admin_api_key>
```

Costs are grouped by model/service description (e.g., `claude-sonnet-4-20250514`, `claude-opus-4-20250514`). The Anthropic Cost API only provides daily cost granularity.
