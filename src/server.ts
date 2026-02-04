import Fastify from "fastify";
import { z } from "zod";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import multipart from "@fastify/multipart";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/client.js';

const upload_path = process.env.UPLOAD_PATH || "uploads"

// Ensure you have access to process.env
const dbPath = process.env.DATABASE_PATH || "./test-tracker.db";

// Better-SQLite3 likes a clean path, but Prisma's URL needs the 'file:' prefix
const connectionUrl = dbPath.startsWith('file:') ? dbPath : `file:${dbPath}`;

const adapter = new PrismaBetterSqlite3({
  url: connectionUrl
});

const prisma = new PrismaClient({ adapter })

const app = Fastify().withTypeProvider<ZodTypeProvider>();

// Setup Zod Validation
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// Support for file uploads
app.register(multipart);

// --- ENDPOINTS ---

// 1. Start Test
app.post(
  "/test/started",
  {
    schema: {
      body: z.object({ name: z.string() }),
    },
  },
  async (req, reply) => {
    const test = await prisma.test.upsert({
      where: { name: req.body.name },
      update: { startedAt: new Date(), finishedAt: null },
      create: { name: req.body.name },
    });
    return { message: `Test ${test.name} started`, id: test.id };
  },
);

// 2. Finish Test
app.post(
  "/test/finished",
  {
    schema: {
      body: z.object({ name: z.string() }),
    },
  },
  async (req, reply) => {
    await prisma.test.update({
      where: { name: req.body.name },
      data: { finishedAt: new Date() },
    });
    return { status: "finished" };
  },
);

// 3. Upload File
app.post("/test/:name/upload/file", async (req, reply) => {
  const { name } = req.params as { name: string };
  const data = await req.file();
  if (!data) throw new Error("No file uploaded");

  const test = await prisma.test.findUnique({ where: { name } });
  if (!test) return reply.status(404).send({ error: "Test not found" });

  const filePath = path.join(
    __dirname,
    upload_path,
    `${data.filename}`,
  );
  await pipeline(data.file, fs.createWriteStream(filePath));

  await prisma.file.create({
    data: {
      originalName: data.filename,
      path: filePath,
      testId: test.id,
    },
  });

  return { message: "File uploaded successfully" };
});

// 4. Get Info
app.get(
  "/test/:name/info",
  {
    schema: {
      params: z.object({ name: z.string() }),
    },
  },
  async (req, reply) => {
    const test = await prisma.test.findUnique({
      where: { name: req.params.name },
      include: { files: true },
    });
    return test || reply.status(404).send({ error: "Not found" });
  },
);

app
  .listen({ port: 3000 })
  .then(() => console.log("Server running on port 3000"));
