/*
  Warnings:

  - Added the required column `parameters` to the `Test` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Test" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "parameters" TEXT NOT NULL
);
INSERT INTO "new_Test" ("finishedAt", "id", "name", "startedAt") SELECT "finishedAt", "id", "name", "startedAt" FROM "Test";
DROP TABLE "Test";
ALTER TABLE "new_Test" RENAME TO "Test";
CREATE UNIQUE INDEX "Test_name_key" ON "Test"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
