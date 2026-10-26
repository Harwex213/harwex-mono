import fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from "@fastify/type-provider-zod";
import {SERVICE_PORT} from "./config/env";
import {logger} from "./config/logger";
import {mapModule} from "./modules/map/map.module";
import {staticModule} from "./modules/static/static.module";

const app = fastify({logger});

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.register(staticModule);
app.register(mapModule, {prefix: "/API"});

app.listen({ port: SERVICE_PORT }, (err) => {
    if (err) {
        app.log.fatal(`Cannot start server listening on ${SERVICE_PORT}: ${err}`);
        process.exit(1);
    }
    app.log.info(`Server listening on ${SERVICE_PORT}`);
})
