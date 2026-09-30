# API Authentication Reference

Direct Dataverse Web API access for table / schema management. Uses Azure CLI authentication (`az account get-access-token`).

The `ms app add data-source --connector dataverse --as table --table <name>` flow does NOT use this — Dataverse table *binding* goes through the CLI and the active `ms` auth context. This reference is for the schema-management path (`add-dataverse` Step 3) where the skill talks to the Dataverse Web API directly to create / extend tables before binding them.

## Prerequisites

Azure CLI must be authenticated before any call:

```bash
az account show
# If not signed in:
az login
```

## Discover the Environment URL

The Dataverse environment URL (e.g., `https://orgname.crm.dynamics.com`) is needed to scope token requests and API calls. Two paths to discover it:

**From the active app** (when in a project workspace):

```bash
ms app show --json | jq -r '.environment.url'
```

(Field name may vary by CLI version — inspect the full envelope first if `.environment.url` doesn't resolve.)

**From the maker portal**: open `https://make.powerapps.com`, switch to the target environment, and read the URL from Settings → Developer resources → Environment URL.

Capture as `$ENV_URL`.

## Get an Access Token

```bash
ENV_URL="https://orgname.crm.dynamics.com"
TOKEN=$(az account get-access-token --resource "$ENV_URL" --query accessToken -o tsv)
```

Tokens last ~1 hour. Refresh by re-running the command — `az` returns a fresh token from the cache or via silent re-auth.

## API Headers

| Header                     | Value                   | Purpose                                  |
| -------------------------- | ----------------------- | ---------------------------------------- |
| `Authorization`            | `Bearer <token>`        | Authentication token                     |
| `Content-Type`             | `application/json`      | Request body format                      |
| `OData-MaxVersion`         | `4.0`                   | Maximum OData version supported          |
| `OData-Version`            | `4.0`                   | OData version to use                     |
| `MSCRM.SolutionUniqueName` | `<solution-name>`       | Add created items to a specific solution |
| `Prefer`                   | `return=representation` | Return created record (with ID) on POST  |

In bash with `curl`:

```bash
curl -sS "$ENV_URL/api/data/v9.2/WhoAmI" \
  -H "Authorization: Bearer $TOKEN" \
  -H "OData-Version: 4.0" \
  -H "OData-MaxVersion: 4.0" \
  -H "Content-Type: application/json"
```

## Discover the Default Publisher Prefix

Custom tables and columns use the active publisher's `customizationprefix` (e.g., `cr3a1_tableName`). Fetch it before creating schema:

```bash
BASE="$ENV_URL/api/data/v9.2"

PREFIX=$(curl -sS \
  "$BASE/publishers?\$filter=friendlyname%20eq%20%27CDS%20Default%20Publisher%27&\$select=customizationprefix,friendlyname" \
  -H "Authorization: Bearer $TOKEN" \
  -H "OData-Version: 4.0" \
  -H "OData-MaxVersion: 4.0" \
  -H "Accept: application/json" \
  | jq -r '.value[0].customizationprefix')

echo "Publisher prefix: $PREFIX"
```

If `.value` is empty, the environment doesn't have a "CDS Default Publisher" — pick a different publisher's prefix or create one in the maker portal.

## Token Refresh in Long-Running Scripts

When a script hits 401:

```bash
TOKEN=$(az account get-access-token --resource "$ENV_URL" --query accessToken -o tsv)
# Re-run the failing call with the fresh token.
```

A simple retry helper:

```bash
api_call() {
  local url="$1"
  local method="${2:-GET}"
  local body="${3:-}"
  local response status

  for attempt in 1 2; do
    if [ -n "$body" ]; then
      response=$(curl -sS -X "$method" "$url" \
        -H "Authorization: Bearer $TOKEN" \
        -H "OData-Version: 4.0" \
        -H "OData-MaxVersion: 4.0" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=representation" \
        -d "$body" -w "\n%{http_code}")
    else
      response=$(curl -sS -X "$method" "$url" \
        -H "Authorization: Bearer $TOKEN" \
        -H "OData-Version: 4.0" \
        -H "OData-MaxVersion: 4.0" \
        -w "\n%{http_code}")
    fi

    status="${response##*$'\n'}"
    body_out="${response%$'\n'*}"

    if [ "$status" = "401" ] && [ "$attempt" = "1" ]; then
      TOKEN=$(az account get-access-token --resource "$ENV_URL" --query accessToken -o tsv)
      continue
    fi
    echo "$body_out"
    return $([ "${status:0:1}" = "2" ] && echo 0 || echo 1)
  done
}
```

## Verify Connection

```bash
curl -sS "$ENV_URL/api/data/v9.2/WhoAmI" \
  -H "Authorization: Bearer $TOKEN" \
  -H "OData-Version: 4.0" \
  -H "OData-MaxVersion: 4.0" \
  -H "Accept: application/json" \
  | jq '.UserId'
```

A successful response prints the active user's GUID.

## Required Permissions

To create tables and manage schema, the active account needs one of:

- **System Administrator** — full access.
- **System Customizer** — can create and modify tables.

Use `ms auth status` to confirm which UPN is active before running schema-management scripts.
