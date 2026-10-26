const logger = {
    level: "debug",
    transport: {
        target: "pino-pretty",
        options: {
            translateTime: "HH:mm:ss Z",
            ignore: "pid,hostname",
            colorize: true,
        }
    }
}

export { logger }