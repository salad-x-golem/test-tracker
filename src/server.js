"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const zod_1 = require("zod");
const fastify_type_provider_zod_1 = require("fastify-type-provider-zod");
const multipart_1 = __importDefault(require("@fastify/multipart"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:stream/promises");
const adapter_better_sqlite3_1 = require("@prisma/adapter-better-sqlite3");
const client_1 = require("./generated/client");
const adapter = new adapter_better_sqlite3_1.PrismaBetterSqlite3({
    url: "file:./test-tracker.db"
});
const prisma = new client_1.PrismaClient({ adapter });
const app = (0, fastify_1.default)().withTypeProvider();
// Setup Zod Validation
app.setValidatorCompiler(fastify_type_provider_zod_1.validatorCompiler);
app.setSerializerCompiler(fastify_type_provider_zod_1.serializerCompiler);
// Support for file uploads
app.register(multipart_1.default);
// --- ENDPOINTS ---
// 1. Start Test
app.post("/test/started", {
    schema: {
        body: zod_1.z.object({ name: zod_1.z.string() }),
    },
}, async (req, reply) => {
    const test = await prisma.test.upsert({
        where: { name: req.body.name },
        update: { startedAt: new Date(), finishedAt: null },
        create: { name: req.body.name },
    });
    return { message: `Test ${test.name} started`, id: test.id };
});
// 2. Finish Test
app.post("/test/finished", {
    schema: {
        body: zod_1.z.object({ name: zod_1.z.string() }),
    },
}, async (req, reply) => {
    await prisma.test.update({
        where: { name: req.body.name },
        data: { finishedAt: new Date() },
    });
    return { status: "finished" };
});
// 3. Upload File
app.post("/test/:name/upload/file", async (req, reply) => {
    const { name } = req.params;
    const data = await req.file();
    if (!data)
        throw new Error("No file uploaded");
    const test = await prisma.test.findUnique({ where: { name } });
    if (!test)
        return reply.status(404).send({ error: "Test not found" });
    const filePath = node_path_1.default.join(__dirname, "uploads", `${Date.now()}-${data.filename}`);
    await (0, promises_1.pipeline)(data.file, node_fs_1.default.createWriteStream(filePath));
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
app.get("/test/:name/info", {
    schema: {
        params: zod_1.z.object({ name: zod_1.z.string() }),
    },
}, async (req, reply) => {
    const test = await prisma.test.findUnique({
        where: { name: req.params.name },
        include: { files: true },
    });
    return test || reply.status(404).send({ error: "Not found" });
});
app
    .listen({ port: 3000 })
    .then(() => console.log("Server running on port 3000"));
