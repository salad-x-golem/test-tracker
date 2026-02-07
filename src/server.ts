import Fastify, { FastifyRequest, FastifyReply } from "fastify";
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
import { timingSafeEqual } from "node:crypto";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/client.js";
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const upload_path = process.env.UPLOAD_PATH || path.join(__dirname, "uploads");
const bearerToken = process.env.BEARER_TOKEN;

async function bearerAuthHook(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!bearerToken) {
    return reply
      .code(401)
      .send({ error: "Authentication is not configured" });
  }
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Missing or invalid authorization header" });
  }
  const token = auth.slice("Bearer ".length);
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(bearerToken);
  if (
    tokenBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(tokenBuffer, expectedBuffer)
  ) {
    return reply.code(401).send({ error: "Invalid token" });
  }
}

try {
  if (!fs.existsSync(upload_path)) {
    fs.mkdirSync(upload_path, { recursive: true });
  }
} catch (err) {
  console.error("Failed to ensure upload directory:", err);
  process.exit(1);
}

// Ensure you have access to process.env
const dbPath = process.env.DATABASE_PATH || "./test-tracker.db";

// Better-SQLite3 likes a clean path, but Prisma's URL needs the 'file:' prefix
const connectionUrl = dbPath.startsWith("file:") ? dbPath : `file:${dbPath}`;

const adapter = new PrismaBetterSqlite3({
  url: connectionUrl,
});

const prisma = new PrismaClient({ adapter });

const app = Fastify().withTypeProvider<ZodTypeProvider>();

// Setup Zod Validation
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// Support for file uploads
app.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 1024,
  },
});

// --- ENDPOINTS ---

// 1. Start Test
app.post(
  "/test/new",
  {
    schema: {
      body: z.object({ name: z.string(), params: z.string() }),
    },
  },
  async (req, reply) => {
    const test = await prisma.test.create({
      data: { name: req.body.name, parameters: req.body.params },
    });
    return { message: `Test ${test.name} created`, id: test.id };
  },
);

// 1. Start Test
app.post(
  "/test/start",
  {
    schema: {
      body: z.object({ name: z.string() }),
    },
  },
  async (req, reply) => {
    const test = await prisma.test.update({
      where: { name: req.body.name, startedAt: null },
      data: { startedAt: new Date(), finishedAt: null },
    });
    return { message: `Test ${test.name} started`, id: test.id };
  },
);

// 2. Finish Test
app.post(
  "/test/finish",
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

  const testDir = path.join(upload_path, test.name);
  try {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  } catch (err) {
    req.log?.error?.(err);
    return reply
      .status(500)
      .send({ error: "Failed to create upload directory" });
  }

  const filename = path.basename(data.filename || "upload");
  const filePath = path.join(testDir, filename);
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

app.post(
    "/public/test/run",
    {
      preHandler: bearerAuthHook,
      schema: {
        // Inputs for the workflow are passed in the JSON body
        body: z.object({
          timeoutMinutes: z.string().default("5"),
          workers: z.string().default('["zeus"]'),
          arkivOpGeth: z.string().default("v1.101605.0-1.2"),
          testLength: z.number().default(60),
          blockEvery: z.number().default(1),
          blockLimit: z.number().default(60000000),
          testScenario: z.string().default("dc_write_only"),
        }),
        response: {
          204: z.object({ message: z.string() }),
          500: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const inputs = request.body;
      const actionName = "l2-arkiv.yml";
      try {
        await octokit.actions.createWorkflowDispatch({
          owner: "salad-x-golem",
          repo: "arkiv-setup",
          workflow_id: actionName,
          ref: "main", // or request.body.ref if you want it dynamic
          inputs: {
            ...inputs,
            // Mapping the hyphenated YAML keys to the underscore-friendly Zod keys
            "arkiv-op-geth": inputs.arkivOpGeth,
            "test-length": inputs.testLength,
            "block-every": inputs.blockEvery,
            "block-limit": inputs.blockLimit,
            "test-scenario": inputs.testScenario,
          },
        });

        return reply.code(204).send({
          message: `Workflow ${actionName} triggered successfully`
        });
      } catch (error: any) {
        return reply.code(500).send({ error: `Failed to trigger workflow ${error}` });
      }
    }
);

// 4. Get Info
app.get(
  "/public/test/:name/info",
  {
    preHandler: bearerAuthHook,
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

// Download file by id
app.get(
  "/public/file/:id/download",
  {
    schema: {
      params: z.object({ id: z.string() }),
    },
  },
  async (req, reply) => {
    const { id } = req.params as { id: string };

    // Support numeric IDs and string/UUID IDs
    const numericId = /^\d+$/.test(id) ? Number(id) : undefined;
    const where: any = numericId !== undefined ? { id: numericId } : { id };

    const file = await prisma.file.findUnique({ where });
    if (!file) return reply.status(404).send({ error: "File not found" });

    if (!fs.existsSync(file.path)) {
      return reply.status(404).send({ error: "File is missing on disk" });
    }

    const filename = file.originalName
      ? path.basename(file.originalName)
      : path.basename(file.path);
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(file.path);
    return reply.send(stream);
  },
);

// Download file by id
app.get(
    "/public/file/:id/view",
    {
      schema: {
        params: z.object({ id: z.string() }),
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      // Support numeric IDs and string/UUID IDs
      const numericId = /^\d+$/.test(id) ? Number(id) : undefined;
      const where: any = numericId !== undefined ? { id: numericId } : { id };

      const file = await prisma.file.findUnique({ where });
      if (!file) return reply.status(404).send({ error: "File not found" });

      if (!fs.existsSync(file.path)) {
        return reply.status(404).send({ error: "File is missing on disk" });
      }

      const filename = file.originalName
          ? path.basename(file.originalName)
          : path.basename(file.path);
      reply.header("Content-Type", "text/html; charset=utf-8");
      reply.header("Content-Disposition", `inline; filename="${filename}"`);

      const stream = fs.createReadStream(file.path);
      return reply.send(stream);
    },
);

app.get("/public/test/list", { preHandler: bearerAuthHook }, async (req, reply) => {
  const tests = await prisma.test.findMany({
    include: { files: true },
    orderBy: { createdAt: "desc" },
  });
  return tests.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
    params: t.parameters,
    files: t.files.map((f) => ({
      id: f.id,
      originalName: f.originalName,
    })),
  }));
});
app
  .listen({ host: "0.0.0.0", port: 3000 })
  .then(() => console.log("Server running on port 3000"));
