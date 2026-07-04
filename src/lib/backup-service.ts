import { PrismaClient } from "@/generated/prisma";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import mysqldump from "mysqldump";
import sql from "mssql";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();

export interface BackupOptions {
  databaseId: number;
  storageId?: number;
}

export interface BackupResult {
  success: boolean;
  filePath?: string;
  size?: number;
  error?: string;
}

type DumpResult = {
  filePath: string;
  size: number;
};

export class BackupService {
  async createBackup(options: BackupOptions): Promise<BackupResult> {
    const { databaseId, storageId } = options;
    const requestId = `backup_${databaseId}_${Date.now()}`;

    try {
      const database = await prisma.database.findUnique({
        where: { id: databaseId },
        include: { storage: true },
      });

      if (!database) {
        logger.database.connectionFailed(databaseId, "Unknown", "Unknown", "Database not found", requestId);
        return { success: false, error: "Database not found" };
      }

      logger.backup.started(database.id, database.name, undefined, requestId);

      const storage = storageId
        ? await prisma.storageAdapter.findUnique({ where: { id: storageId } })
        : database.storage;

      if (!storage) {
        return { success: false, error: "No storage adapter configured" };
      }

      const backupJob = await prisma.backupJob.create({
        data: {
          databaseId,
          storageId: storage.id,
          status: "RUNNING",
          startedAt: new Date(),
        },
      });

      const backupResult = await this.performBackup(database, storage);

      await prisma.backupJob.update({
        where: { id: backupJob.id },
        data: {
          status: backupResult.success ? "SUCCESS" : "FAILED",
          finishedAt: new Date(),
          filePath: backupResult.success ? backupResult.filePath : undefined,
          size: backupResult.success ? backupResult.size : undefined,
          log: backupResult.error || "Backup completed successfully",
        },
      });

      return backupResult;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Failed to create backup job" };
    }
  }

  private async performBackup(database: any, storage: any): Promise<BackupResult> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${this.safeName(database.name)}_${timestamp}.sql`;

      switch (storage.type) {
        case "LOCAL":
          return await this.performLocalBackup(database, storage, filename);
        case "S3":
          return await this.performS3Backup(database, storage, filename);
        case "SFTP":
          return await this.performSftpBackup(database, storage, filename);
        case "GOOGLE_DRIVE":
          return await this.performGoogleDriveBackup(database, storage, filename);
        case "AZURE_BLOB":
          return await this.performAzureBlobBackup(database, storage, filename);
        default:
          return { success: false, error: `Unsupported storage type: ${storage.type}` };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Backup failed" };
    }
  }

  private async performLocalBackup(database: any, storage: any, filename: string): Promise<BackupResult> {
    const config = storage.config as any;
    const storagePath = config.path || "public/backups";
    const databaseFolderName = this.databaseFolderName(database);
    const fullStoragePath = path.resolve(process.cwd(), storagePath, databaseFolderName);
    await fs.mkdir(fullStoragePath, { recursive: true });

    const filePath = path.join(fullStoragePath, filename);
    const dump = await this.dumpDatabase(database, filePath);

    return {
      success: true,
      filePath: path.relative(process.cwd(), dump.filePath),
      size: dump.size,
    };
  }

  private async performS3Backup(database: any, storage: any, filename: string): Promise<BackupResult> {
    const config = storage.config as any;
    if (!config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
      return { success: false, error: "S3 credentials or bucket name not configured" };
    }

    const temp = await this.createTempDump(database, filename);
    try {
      const fileBuffer = await fs.readFile(temp.filePath);
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const s3Client = new S3Client({
        region: config.region || "us-east-1",
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });

      const key = config.keyPrefix
        ? `${config.keyPrefix}/${this.databaseFolderName(database)}/${filename}`
        : `${this.databaseFolderName(database)}/${filename}`;

      await s3Client.send(new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: "application/sql",
        ServerSideEncryption: "AES256",
      }));

      return { success: true, filePath: `s3://${config.bucketName}/${key}`, size: fileBuffer.length };
    } finally {
      await this.cleanupTempPath(temp.filePath, temp.dirPath);
    }
  }

  private async performSftpBackup(database: any, storage: any, filename: string): Promise<BackupResult> {
    const config = storage.config as any;
    if (!config.host || !config.username) {
      return { success: false, error: "SFTP host and username not configured" };
    }

    const temp = await this.createTempDump(database, filename);
    try {
      const fileBuffer = await fs.readFile(temp.filePath);
      const { uploadToSftpServer } = await import("./sftp-server");
      const remotePath = `${config.remotePath || "/backups"}/${this.databaseFolderName(database)}`;
      const uploadResult = await uploadToSftpServer(
        filename,
        fileBuffer,
        { host: config.host, username: config.username, password: config.password, port: config.port || 22 },
        remotePath,
      );

      if (!uploadResult.success) {
        return { success: false, error: uploadResult.error || "SFTP upload failed" };
      }

      return { success: true, filePath: uploadResult.fileId, size: fileBuffer.length };
    } finally {
      await this.cleanupTempPath(temp.filePath, temp.dirPath);
    }
  }

  private async performGoogleDriveBackup(database: any, storage: any, filename: string): Promise<BackupResult> {
    const config = storage.config as any;
    if (!config.accessToken) {
      return { success: false, error: "Google Drive not authenticated" };
    }

    const temp = await this.createTempDump(database, filename);
    try {
      const fileBuffer = await fs.readFile(temp.filePath);
      const { uploadToGoogleDrive } = await import("./google-oauth");
      const uploadResult = await uploadToGoogleDrive(
        filename,
        fileBuffer,
        { access_token: config.accessToken, refresh_token: config.refreshToken },
        config.folderId,
      );

      if (!uploadResult.success) {
        return { success: false, error: uploadResult.error || "Google Drive upload failed" };
      }

      return { success: true, filePath: `gdrive://${uploadResult.fileId}`, size: fileBuffer.length };
    } finally {
      await this.cleanupTempPath(temp.filePath, temp.dirPath);
    }
  }

  private async performAzureBlobBackup(database: any, storage: any, filename: string): Promise<BackupResult> {
    const config = storage.config as any;
    if (!config.connectionString || !config.containerName) {
      return { success: false, error: "Azure Blob Storage connection string or container name not configured" };
    }

    const temp = await this.createTempDump(database, filename);
    try {
      const fileBuffer = await fs.readFile(temp.filePath);
      const { BlobServiceClient } = await import("@azure/storage-blob");
      const blobServiceClient = BlobServiceClient.fromConnectionString(config.connectionString);
      const containerClient = blobServiceClient.getContainerClient(config.containerName);
      await containerClient.createIfNotExists();

      const blobName = config.blobPrefix
        ? `${config.blobPrefix}/${this.databaseFolderName(database)}/${filename}`
        : `${this.databaseFolderName(database)}/${filename}`;

      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.upload(fileBuffer, fileBuffer.length, {
        blobHTTPHeaders: { blobContentType: "application/sql" },
      });

      return { success: true, filePath: `azure://${config.containerName}/${blobName}`, size: fileBuffer.length };
    } finally {
      await this.cleanupTempPath(temp.filePath, temp.dirPath);
    }
  }

  private async createTempDump(database: any, filename: string): Promise<{ filePath: string; dirPath: string; size: number }> {
    const dirPath = path.join(process.cwd(), "temp", this.databaseFolderName(database));
    await fs.mkdir(dirPath, { recursive: true });
    const filePath = path.join(dirPath, filename);
    const dump = await this.dumpDatabase(database, filePath);
    return { filePath: dump.filePath, dirPath, size: dump.size };
  }

  private async dumpDatabase(database: any, outputFilePath: string): Promise<DumpResult> {
    switch (database.type) {
      case "MYSQL":
        await mysqldump({
          connection: {
            host: database.host,
            port: database.port,
            user: database.username,
            password: database.password,
            database: database.name,
          },
          dumpToFile: outputFilePath,
        });
        break;
      case "POSTGRES":
        await this.dumpPostgres(database, outputFilePath);
        break;
      case "SQLSERVER":
        await this.dumpSqlServer(database, outputFilePath);
        break;
      default:
        throw new Error(`Unsupported database type: ${database.type}`);
    }

    const stats = await fs.stat(outputFilePath);
    if (!stats.isFile() || stats.size <= 0) {
      throw new Error("Backup dump was empty or missing");
    }

    return { filePath: outputFilePath, size: stats.size };
  }

  private async dumpPostgres(database: any, outputFilePath: string): Promise<void> {
    await execFileAsync("pg_dump", [
      "-h", String(database.host),
      "-p", String(database.port),
      "-U", String(database.username),
      "-d", String(database.name),
      "-f", outputFilePath,
    ], {
      env: { ...process.env, PGPASSWORD: String(database.password) },
      timeout: 30 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 10,
    });
  }

  private async dumpSqlServer(database: any, outputFilePath: string): Promise<void> {
    const pool = await sql.connect({
      user: database.username,
      password: database.password,
      server: database.host,
      port: database.port,
      database: database.name,
      options: { encrypt: false, trustServerCertificate: true },
    });

    try {
      const tables = await pool.request().query("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'");
      let dump = `-- SQL Server logical backup for ${database.name} at ${new Date().toISOString()}\n\n`;

      for (const row of tables.recordset) {
        const schema = row.TABLE_SCHEMA;
        const table = row.TABLE_NAME;
        const result = await pool.request().query(`SELECT * FROM [${schema}].[${table}]`);
        dump += `-- Table: [${schema}].[${table}]\n`;

        for (const record of result.recordset) {
          const columns = Object.keys(record).map((col) => `[${col.replace(/]/g, "]] ")}]`).join(", ");
          const values = Object.values(record).map((value) => this.sqlLiteral(value)).join(", ");
          dump += `INSERT INTO [${schema}].[${table}] (${columns}) VALUES (${values});\n`;
        }
        dump += "\n";
      }

      await fs.writeFile(outputFilePath, dump);
    } finally {
      await pool.close();
    }
  }

  async listBackups(databaseId?: number): Promise<any[]> {
    const where = databaseId ? { databaseId } : {};
    const backups = await prisma.backupJob.findMany({
      where,
      include: {
        database: { select: { name: true } },
        storage: { select: { name: true, type: true } },
      },
      orderBy: { startedAt: "desc" },
    });

    return backups.map((backup) => ({
      id: backup.id,
      database: backup.database,
      storage: backup.storage,
      status: backup.status.toLowerCase(),
      startTime: backup.startedAt.toISOString(),
      endTime: backup.finishedAt?.toISOString(),
      size: backup.size ? this.formatFileSize(backup.size) : undefined,
      duration: backup.finishedAt ? this.formatDuration(backup.finishedAt.getTime() - backup.startedAt.getTime()) : undefined,
      type: "full",
      location: backup.filePath || "Unknown",
      filePath: backup.filePath,
    }));
  }

  private safeName(value: string): string {
    return String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");
  }

  private databaseFolderName(database: any): string {
    return `db_${database.id}_${this.safeName(database.name)}`;
  }

  private sqlLiteral(value: unknown): string {
    if (value === null || typeof value === "undefined") return "NULL";
    if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
    if (typeof value === "number" || typeof value === "bigint") return String(value);
    if (typeof value === "boolean") return value ? "1" : "0";
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private async cleanupTempPath(filePath: string, dirPath: string): Promise<void> {
    await fs.unlink(filePath).catch(() => undefined);
    await fs.rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
  }

  private formatFileSize(bytes: number): string {
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 B";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  async clearAllBackups(): Promise<{ success: boolean; error?: string }> {
    try {
      const backupsPath = path.join(process.cwd(), "public", "backups");
      const tempPath = path.join(process.cwd(), "temp");
      await fs.rm(backupsPath, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(tempPath, { recursive: true, force: true }).catch(() => undefined);
      await fs.mkdir(backupsPath, { recursive: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Failed to clear backup folders" };
    }
  }
}

export const backupService = new BackupService();
