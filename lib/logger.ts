import pino from 'pino';

const logger = pino.default({
    level: 'debug',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    }
});

const honoLogPrintFunc = (message: string, ...rest: string[]) => {
    logger.info(message, ...rest);
}

export { logger, honoLogPrintFunc };
