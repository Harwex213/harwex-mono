import fastify from 'fastify';
import {SERVICE_PORT} from "./config/env";
import {logger} from "./config/logger";

const app = fastify({logger});

app.listen({ port: SERVICE_PORT }, (err) => {
    if (err) {
        app.log.fatal(`Cannot start server listening on ${SERVICE_PORT}: ${err}`);
        process.exit(1);
    }
    app.log.info(`Server listening on ${SERVICE_PORT}`);
})