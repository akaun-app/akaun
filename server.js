import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { handler } from './build/handler.js';

const port = process.env.PORT || '3000';
const host = process.env.HOST || '0.0.0.0';
const sslEnabled = process.env.SSL_ENABLED === 'true';

const server = sslEnabled
	? https.createServer(
			{
				key: fs.readFileSync(process.env.SSL_KEY_PATH),
				cert: fs.readFileSync(process.env.SSL_CERT_PATH)
			},
			handler
		)
	: http.createServer(handler);

server.listen(port, host, () => {
	console.log(`Listening on ${sslEnabled ? 'https' : 'http'}://${host}:${port}`);
});
