/*
  Warnings:

  - Added the required column `size` to the `File` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_File" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uid" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "testId" INTEGER NOT NULL,
    CONSTRAINT "File_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_File" ("id", "originalName", "path", "testId", "uid") SELECT "id", "originalName", "path", "testId", "uid" FROM "File";
DROP TABLE "File";
ALTER TABLE "new_File" RENAME TO "File";
CREATE UNIQUE INDEX "File_uid_key" ON "File"("uid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
