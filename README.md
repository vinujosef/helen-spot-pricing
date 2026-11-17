# PowerPrice Helen

A lightweight, always-on Finland electricity price dashboard designed for an old iPad.

## Features

- Current 15-minute electricity price
- Full-day stepped price graph
- Hover/tap tooltip with exact 15-minute price
- Current 15-minute block highlighted
- Past prices faded; future prices emphasized
- Cheapest and most expensive 1-hour windows highlighted on the graph
- Next-lowest remaining 15-minute slot
- Best remaining 1-hour window
- Today / Tomorrow view
- Tomorrow button automatically becomes available after tomorrow's prices are published; the app starts checking every 5 minutes after 14:20
- Live clock with running seconds


## Run locally

On macOS, copy `.env.example` to `.env`.

Adjust the host or port if needed, then run `./test-locally.sh` from the project directory to start the server and open the dashboard in your browser. 


```
The script builds the browser URL from `HOST` and `PORT`.
```

## Server deployment

Suggested location:

```text
/opt/apps/services/powerprice-helen
```

Example systemd service:

```ini
[Unit]
Description=PowerPrice Helen Dashboard
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/opt/apps/services/helen-spot-price
ExecStart=/usr/bin/python3 -m http.server <port> --bind 0.0.0.0
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

After changing files, a browser refresh is normally enough. Restarting the service is not usually necessary because Python serves the files directly from disk.

## Data

The app uses public Finland day-ahead electricity price data and displays prices in c/kWh including VAT.

No backend or build process is required.
