import {
  createConfigSecretEnumerator,
  WinstonLogger,
} from '@backstage/backend-app-api';
import { DynamicPluginsSchemasService } from '@backstage/backend-dynamic-feature-service';
import {
  coreServices,
  createServiceFactory,
  createServiceRef,
} from '@backstage/backend-plugin-api';
import { loadConfigSchema } from '@backstage/config-loader';
import { getPackages } from '@manypkg/get-packages';
import * as winston from 'winston';

const defaultFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss',
  }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
);

const auditLogFormat = winston.format((info, opts) => {
  const { isAuditLog, ...newInfo } = info;

  if (isAuditLog) {
    return opts.isAuditLog ? newInfo : false;
  }

  return !opts.isAuditLog ? newInfo : false;
});

const transports = {
  log: [
    new winston.transports.Console({
      format: winston.format.combine(
        auditLogFormat({ isAuditLog: false }),
        winston.format.colorize(),
        defaultFormat,
        winston.format.simple(),
      ),
    }),
  ],
  auditLog: [
    new winston.transports.Console({
      format: winston.format.combine(
        auditLogFormat({ isAuditLog: true }),
        winston.format.colorize(),
        defaultFormat,
        winston.format.simple(),
      ),
    }),
  ],
};

const dynamicPluginsSchemasServiceRef =
  createServiceRef<DynamicPluginsSchemasService>({
    id: 'core.dynamicplugins.schemas',
    scope: 'root',
  });

export const customLogger = createServiceFactory({
  service: coreServices.rootLogger,
  deps: {
    config: coreServices.rootConfig,
    schemas: dynamicPluginsSchemasServiceRef,
  },
  async factory({ config, schemas }) {
    const logger = WinstonLogger.create({
      meta: {
        service: 'backstage',
      },
      level: process.env.LOG_LEVEL ?? 'info',
      format: winston.format.combine(defaultFormat, winston.format.json()),
      transports: [...transports.log, ...transports.auditLog],
    });

    const configSchema = await loadConfigSchema({
      dependencies: (await getPackages(process.cwd())).packages.map(
        p => p.packageJson.name,
      ),
    });

    const secretEnumerator = await createConfigSecretEnumerator({
      logger,
      schema: (await schemas.addDynamicPluginsSchemas(configSchema)).schema,
    });
    logger.addRedactions(secretEnumerator(config));
    config.subscribe?.(() => logger.addRedactions(secretEnumerator(config)));

    return logger;
  },
});
