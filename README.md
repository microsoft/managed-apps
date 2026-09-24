# Apps on Microsoft Copilot Managed Runtime

> [!NOTE]
> Copilot Managed Runtime is in **public preview**. APIs, templates, and tooling may change before general availability.

Copilot Managed Runtime hosts Microsoft 365 line-of-business applications that automatically inherit organizational governance, security, and compliance controls from the moment they're created.

This repository hosts the official first-party project **templates** and is the home for **public issues**. The tooling itself ships as npm packages under the `@microsoft/managed-apps` scope:

| Package | Description |
| --- | --- |
| [`@microsoft/managed-apps`](https://www.npmjs.com/package/@microsoft/managed-apps) | SDK for building apps hosted on Copilot Managed Runtime |
| [`@microsoft/managed-apps-cli`](https://www.npmjs.com/package/@microsoft/managed-apps-cli) | Command-line interface for building and managing apps hosted on Copilot Managed Runtime |
| [`@microsoft/managed-apps-vite-plugin`](https://www.npmjs.com/package/@microsoft/managed-apps-vite-plugin) | Vite plugin for apps hosted on Copilot Managed Runtime |

## Getting started

See the [Quickstart - CLI](https://go.microsoft.com/fwlink/?LinkId=2368962) to set up your local dev environment and build your first app.

## Repository structure

- [`templates/`](templates/) — first-party project templates (currently [`vite8`](templates/vite8), a React + TypeScript + Vite 8 starter).
- [`plugins/`](plugins/) — the [`microsoft-managed-apps`](plugins/microsoft-managed-apps) plugin: skills, agents, and hooks for building apps hosted on Copilot Managed Runtime with AI coding agents (works with Claude Code and GitHub Copilot).
- [`.claude-plugin/`](.claude-plugin/) — marketplace manifest (`marketplace.json`) that registers the plugin so agents can install it via `/plugin marketplace add`.

## Documentation

See the [Microsoft Copilot Managed Runtime documentation](https://go.microsoft.com/fwlink/?LinkId=2372842).

## Support

This project uses GitHub Issues to track bugs. Please search existing issues before filing a new one to avoid duplicates. For a new bug, open an issue in this repository. See [SUPPORT.md](SUPPORT.md) for details.

## Contributing

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
