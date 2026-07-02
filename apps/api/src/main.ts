import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { loadEnv } from "@notetaker/config";
import { AppModule } from "./app.module";

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { rawBody: true },
  );
  app.enableCors({ origin: true });
  await app.listen(env.PORT, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://localhost:${env.PORT}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[api] failed to start:", err);
  process.exit(1);
});
