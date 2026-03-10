# Nginx GeoIP Dashboard Setup Guide

This guide explains how to set up and use the enhanced Nginx GeoIP dashboard with Prometheus, Loki, and Grafana.

## What's New

- ✅ **Enhanced Dashboard** (`nginx-geoip.json`) with comprehensive metrics
- ✅ **JSON Log Format** for better data extraction
- ✅ **Geographic Analysis** ready for GeoIP enrichment
- ✅ **Performance Metrics** (response times, percentiles)
- ✅ **Error Analysis** with detailed breakdowns

## Quick Start

### 1. Update Nginx Configuration (Already Done ✓)

JSON log format has been added to:
- `nginx/nginx.dev.conf` - Development config
- `nginx/nginx.prod.conf` - Production config

The new format captures:
- Timestamp, Client IP, Request method, URI, Path
- Status code, Bytes sent, Response time
- Upstream response time, Referer, User Agent
- HTTP Host, Scheme, Request ID

### 2. Update Promtail (Already Done ✓)

The `promtail-config.yml` has been updated to:
- Parse JSON logs (primary)
- Fall back to regex parsing for legacy format
- Extract and label: method, status, path, client_ip, response_time, http_host

### 3. Restart Services

```bash
docker compose down
docker compose up -d
```

Services will automatically reload the new configurations.

### 4. Access the Dashboard

1. Go to Grafana at `http://localhost/grafana/`
2. Navigate to **Dashboards** → Search for **"Nginx GeoIP"**
3. Select the **"Nginx GeoIP Dashboard"** to view metrics

## Dashboard Panels

### Overview Section
- **Unique IPs (1h)** - Distinct client IPs in last hour
- **Total Requests** - All requests in selected time range
- **2xx Success** - Successful responses
- **4xx Errors** - Client errors
- **5xx Errors** - Server errors
- **Avg Response Time** - Mean response duration

### Traffic Analysis
- **Requests by HTTP Status** - Stacked bar chart by status code
- **HTTP Status Distribution** - Pie chart breakdown
- **Requests by HTTP Method** - GET, POST, PUT, etc.
- **Response Time (p95)** - 95th percentile latency

### Geographic & Source Analysis
- **Top 10 IPs** - Most active client IPs
- **Top 10 Paths** - Most requested endpoints
- **Top 10 Hosts** - Request distribution by hostname
- **Top 10 Referrers** - Incoming traffic sources
- **Top 10 User Agents** - Browser/client breakdown

### Error Analysis
- **Top 10 Error Paths** - Endpoints with most errors
- **Error Status Distribution** - 4xx vs 5xx breakdown

### Real-time Logs
- **Real-time Logs** - Live access logs with filtering

## Variable Filters

The dashboard includes several filters at the top:

| Filter | Options | Description |
|--------|---------|-------------|
| **Status Code** | all, 2xx, 3xx, 4xx, 5xx, specific codes | Filter by HTTP status |
| **HTTP Method** | all, GET, POST, PUT, PATCH, DELETE | Filter by request method |
| **Path Filter** | Text search | Filter paths containing text |
| **IP Filter** | Text search | Filter client IPs matching pattern |

## GeoIP Enrichment (Optional - Advanced)

### Option 1: Using Loki GeoIP Plugin (Recommended)

Loki v2.8+ supports the GeoIP filter in LogQL. To enable:

1. **Download GeoIP Database**
   ```bash
   mkdir -p ./geoip-data
   wget https://geolite.maxmind.com/download/geoip/database/GeoLite2-City.tar.gz
   tar -xzf GeoLite2-City.tar.gz -C ./geoip-data
   ```

2. **Mount in docker-compose.yml**
   ```yaml
   loki:
     volumes:
       - ./geoip-data:/etc/loki/geoip:ro
   ```

3. **Update Loki Config** (`loki-config.yml`)
   ```yaml
   limits_config:
     allow_structured_metadata: true

   # Add after schema_config
   processing:
     enabled: true
     pipeline:
       stages:
         - geoip:
             db: /etc/loki/geoip/GeoLite2-City.mmdb
             source: client_ip
   ```

4. **Use in LogQL Queries**
   ```logql
   {service="nginx"} | json | geoip | country_code
   ```

### Option 2: Using Promtail with Lua Script

1. **Create Lua Script** for GeoIP lookup:
   ```lua
   -- /etc/promtail/geoip.lua
   local geoip = require("geoip2.city")
   local reader = geoip.open("/etc/promtail/GeoLite2-City.mmdb")

   function process(entry)
       local ip = entry["client_ip"]
       if ip then
           local response = reader:city(ip)
           if response then
               entry["country"] = response:country():name()
               entry["country_code"] = response:country():iso_code()
               entry["city"] = response:city():name()
               entry["latitude"] = response:location():latitude()
               entry["longitude"] = response:location():longitude()
           end
       end
       return entry
   end
   ```

2. **Update promtail-config.yml**
   ```yaml
   pipeline_stages:
     - script:
         script: /etc/promtail/geoip.lua
   ```

### Option 3: Post-Processing with Grafana

Use Grafana's built-in GeoIP database:

1. In dashboard, add a **Geomap** panel
2. Configure data source as Loki
3. Use query:
   ```logql
   topk(100, sum(count_over_time({service="nginx"} | json [$__range])) by (client_ip))
   ```
4. In panel options:
   - **Location Data**: Table (IP address)
   - **Map Layers**: OpenStreetMap
   - Grafana will automatically geolocate IPs

## Querying Examples

### Count requests by country (with GeoIP enrichment)
```logql
sum(count_over_time({service="nginx"} | json | country_code != "" [$__range])) by (country_code)
```

### Top IPs with response times
```logql
topk(10, avg(count_over_time({service="nginx"} | json | unwrap response_time [$__range])) by (client_ip))
```

### Error rate by endpoint
```logql
sum(rate({service="nginx"} | json | status =~ "5[0-9]{2}" [5m])) by (path)
```

### Slow requests (> 1s response time)
```logql
{service="nginx"} | json | response_time > 1
```

### Specific path performance
```logql
histogram_quantile(0.95, sum(rate({service="nginx"} | json | path="/api/v1/users" | unwrap response_time [2m])) by (le))
```

## Troubleshooting

### Logs not appearing in Loki
1. Check Promtail is running: `docker logs minispace_promtail`
2. Verify promtail config: `docker exec minispace_promtail cat /etc/promtail/config.yml`
3. Check Loki is receiving logs: `docker logs minispace_loki | grep nginx`

### Dashboard shows no data
1. Verify time range is recent (use "Last 1 hour")
2. Check filters aren't too restrictive
3. Ensure nginx is receiving traffic

### JSON parsing not working
1. Verify log format: `docker exec minispace_nginx cat /var/log/nginx/access.log | head -1`
2. Should be valid JSON, not legacy format
3. If hybrid format: promtail tries JSON first, falls back to regex

### GeoIP data not appearing
1. Verify GeoIP database file exists and is readable
2. Check Loki/Promtail logs for GeoIP errors
3. Ensure IP addresses are valid public IPs (not localhost/127.0.0.1)

## Performance Notes

- **Log Retention**: Default 30 days in Prometheus (adjust `prometheus.yml` if needed)
- **Loki Retention**: Default 30 days (set in `loki-config.yml` `retention_period`)
- **Query Performance**: Use narrow time ranges for large datasets
- **GeoIP Database Size**: ~40MB for GeoLite2-City

## Security Considerations

- ⚠️ **GeoIP Database**: MaxMind requires free registration for GeoLite2
- ⚠️ **IP Logging**: Consider privacy implications of logging client IPs
- ⚠️ **Access Control**: Grafana access should be restricted to admins only

## Next Steps

1. ✅ Monitor the dashboard daily for traffic patterns
2. ✅ Set up alerts for error spikes (5xx > 5%)
3. ✅ Implement GeoIP enrichment for geographic insights
4. ✅ Create custom dashboards for specific endpoints
5. ✅ Export logs regularly for compliance archival

## Reference

- [Nginx Logging Documentation](http://nginx.org/en/docs/http/ngx_http_log_module.html)
- [Promtail Pipeline Stages](https://grafana.com/docs/loki/latest/clients/promtail/stages/)
- [LogQL Docs](https://grafana.com/docs/loki/latest/logql/)
- [MaxMind GeoIP2](https://www.maxmind.com/en/geoip2-databases)
