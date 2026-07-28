import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { handler } from './build/handler.js';

process.on('unhandledRejection', (reason) => {
	console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
	console.error('[uncaughtException]', err);
	process.exit(1); // undefined state after this — let the orchestrator restart
});

const port = process.env.PORT || '3000';
const host = process.env.HOST || '0.0.0.0';
const sslEnabled = process.env.SSL_ENABLED === 'true';
const shutdownToken = process.env.SHUTDOWN_TOKEN || '';

// Only active when SHUTDOWN_TOKEN is set (desktop sidecar launches only — never
// documented/set for Docker deployments). Lets the Tauri tray app stop this
// process gracefully instead of a hard kill, which has no portable equivalent
// across Windows/macOS/Linux.
function requestListener(req, res) {
	if (shutdownToken && req.method === 'POST' && req.url === '/__akaun/shutdown') {
		if (req.headers['x-shutdown-token'] === shutdownToken) {
			res.writeHead(200).end('ok');
			server.close(() => process.exit(0));
			return;
		}
		res.writeHead(403).end('forbidden');
		return;
	}
	handler(req, res);
}

const server = sslEnabled
	? https.createServer(
			{
				key: fs.readFileSync(process.env.SSL_KEY_PATH),
				cert: fs.readFileSync(process.env.SSL_CERT_PATH)
			},
			requestListener
		)
	: http.createServer(requestListener);

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.listen(port, host, () => {
	console.log(`Listening on ${sslEnabled ? 'https' : 'http'}://${host}:${port}`);
});
