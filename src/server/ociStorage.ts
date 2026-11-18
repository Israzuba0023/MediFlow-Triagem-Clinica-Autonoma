import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeSha256,
  decryptAtRest,
  encryptAtRest,
  getVaultDir,
  type EncryptedEnvelope,
} from './security.ts';

// Diretório espelho local dos buckets OCI e cota padrão da camada Always Free (20 GB)
const OCI_VAULT_ROOT = path.join(getVaultDir(), 'oci-buckets');
const BUCKET_NAME = process.env.OCI_BUCKET_NAME || 'mediflow-documentos-clinicos';
const ALWAYS_FREE_QUOTA_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB OCI Always Free

// Prefixos segregados conforme o estágio do documento na triagem clínica
export type OciFolderPrefix =
  | 'recebidos'
  | 'processados/urgentes'
  | 'processados/rotina'
  | 'auditoria_humana'
  | 'rejeitados';

interface StoredObjectMeta {
  bucket: string;
  objectPath: string;
  prefix: OciFolderPrefix;
  documentoId: string;
  contentType: string;
  sizeBytes: number;
  sha256Checksum: string;
  encryption: 'AES-256-GCM';
  createdAt: string;
  remoteSynced: boolean;
  envelope: EncryptedEnvelope;
}

function ensureBucketFolders(): void {
  const prefixes: OciFolderPrefix[] = [
    'recebidos',
    'processados/urgentes',
    'processados/rotina',
    'auditoria_humana',
    'rejeitados',
  ];
  for (const p of prefixes) {
    const dir = path.join(OCI_VAULT_ROOT, BUCKET_NAME, p);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }
}

ensureBucketFolders();

function isRemoteOciParConfigured(): boolean {
  return Boolean(process.env.OCI_PAR_BASE_URL && process.env.OCI_PAR_BASE_URL.startsWith('https://'));
}

function isRemoteOciS3Configured(): boolean {
  return Boolean(
    process.env.OCI_S3_ENDPOINT &&
      process.env.OCI_ACCESS_KEY_ID &&
      process.env.OCI_SECRET_ACCESS_KEY
  );
}

// Envio via Pre-Authenticated Request (PAR) da Oracle Cloud Infrastructure
async function putObjectViaOciPar(objectPath: string, payload: Buffer, contentType: string): Promise<boolean> {
  const baseUrl = process.env.OCI_PAR_BASE_URL;
  if (!baseUrl) return false;
  try {
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const targetUrl = `${normalizedBase}${objectPath}`;
    const res = await fetch(targetUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'x-oci-encryption': 'AES-256-GCM',
      },
      body: new Uint8Array(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Assinatura AWS Signature v4 compatível com a API S3 do OCI Object Storage
async function putObjectViaOciS3(objectPath: string, payload: Buffer, contentType: string): Promise<boolean> {
  const endpoint = process.env.OCI_S3_ENDPOINT;
  const accessKey = process.env.OCI_ACCESS_KEY_ID;
  const secretKey = process.env.OCI_SECRET_ACCESS_KEY;
  const region = process.env.OCI_REGION || 'sa-saopaulo-1';
  if (!endpoint || !accessKey || !secretKey) return false;

  try {
    const url = new URL(`${endpoint.replace(/\/$/, '')}/${BUCKET_NAME}/${objectPath}`);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = computeSha256(payload);

    const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      'PUT',
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      computeSha256(canonicalRequest),
    ].join('\n');

    const hmac = (key: Buffer | string, data: string) =>
      crypto.createHmac('sha256', key).update(data).digest();

    const kDate = hmac(`AWS4${secretKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(url.toString(), {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        Authorization: authorization,
      },
      body: new Uint8Array(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function getOciConfigStatus() {
  const remoteMode = isRemoteOciParConfigured()
    ? 'OCI_PAR_ENDPOINT'
    : isRemoteOciS3Configured()
      ? 'OCI_S3_COMPATIBLE'
      : 'ENCRYPTED_ALWAYS_FREE_VAULT';

  return {
    bucketName: BUCKET_NAME,
    namespace: process.env.OCI_NAMESPACE || 'one-g10-always-free',
    region: process.env.OCI_REGION || 'sa-saopaulo-1',
    remoteConfigured: isRemoteOciParConfigured() || isRemoteOciS3Configured(),
    integrationMode: remoteMode,
    alwaysFreeQuotaBytes: ALWAYS_FREE_QUOTA_BYTES,
  };
}

export async function putOciObject(params: {
  prefix: OciFolderPrefix;
  filename: string;
  documentoId: string;
  content: string | Buffer;
  contentType: string;
}): Promise<{
  bucket: string;
  objectPath: string;
  sizeBytes: number;
  sha256Checksum: string;
  remoteSynced: boolean;
  mode: 'oci_remoto_sincronizado' | 'cofre_oci_always_free';
}> {
  ensureBucketFolders();
  const safeFilename = params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectPath = `${params.prefix}/${safeFilename}`;
  const rawBuf = typeof params.content === 'string' ? Buffer.from(params.content, 'utf8') : params.content;
  const sha256Checksum = computeSha256(rawBuf);
  const envelope = encryptAtRest(rawBuf);

  let remoteSynced = false;
  if (isRemoteOciParConfigured()) {
    remoteSynced = await putObjectViaOciPar(
      objectPath,
      Buffer.from(JSON.stringify(envelope), 'utf8'),
      'application/json'
    );
  } else if (isRemoteOciS3Configured()) {
    remoteSynced = await putObjectViaOciS3(
      objectPath,
      Buffer.from(JSON.stringify(envelope), 'utf8'),
      'application/json'
    );
  }

  const stored: StoredObjectMeta = {
    bucket: BUCKET_NAME,
    objectPath,
    prefix: params.prefix,
    documentoId: params.documentoId,
    contentType: params.contentType,
    sizeBytes: rawBuf.byteLength,
    sha256Checksum,
    encryption: 'AES-256-GCM',
    createdAt: new Date().toISOString(),
    remoteSynced,
    envelope,
  };

  const fullDiskPath = path.join(OCI_VAULT_ROOT, BUCKET_NAME, `${objectPath}.enc.json`);
  fs.writeFileSync(fullDiskPath, JSON.stringify(stored, null, 2), { mode: 0o600 });

  return {
    bucket: BUCKET_NAME,
    objectPath,
    sizeBytes: rawBuf.byteLength,
    sha256Checksum,
    remoteSynced,
    mode: remoteSynced ? 'oci_remoto_sincronizado' : 'cofre_oci_always_free',
  };
}

export async function moveOciObject(params: {
  sourceObjectPath: string;
  targetPrefix: OciFolderPrefix;
  updatedJsonContent: string;
  documentoId: string;
}): Promise<{
  bucket: string;
  objectPath: string;
  sizeBytes: number;
  sha256Checksum: string;
  mode: 'oci_remoto_sincronizado' | 'cofre_oci_always_free';
}> {
  const filename = path.basename(params.sourceObjectPath);
  const oldDiskPath = path.join(OCI_VAULT_ROOT, BUCKET_NAME, `${params.sourceObjectPath}.enc.json`);

  const result = await putOciObject({
    prefix: params.targetPrefix,
    filename,
    documentoId: params.documentoId,
    content: params.updatedJsonContent,
    contentType: 'application/json',
  });

  if (fs.existsSync(oldDiskPath) && params.sourceObjectPath !== result.objectPath) {
    fs.unlinkSync(oldDiskPath);
  }

  return result;
}

export interface ListedOciObject {
  bucket: string;
  objectPath: string;
  prefix: OciFolderPrefix;
  documentoId: string;
  contentType: string;
  sizeBytes: number;
  sha256Checksum: string;
  encryption: 'AES-256-GCM';
  createdAt: string;
  remoteSynced: boolean;
}

export function listOciBucketObjects(): {
  config: ReturnType<typeof getOciConfigStatus>;
  totalBytesUsed: number;
  countsByPrefix: Record<OciFolderPrefix, number>;
  objects: ListedOciObject[];
} {
  ensureBucketFolders();
  const prefixes: OciFolderPrefix[] = [
    'recebidos',
    'processados/urgentes',
    'processados/rotina',
    'auditoria_humana',
    'rejeitados',
  ];

  const objects: ListedOciObject[] = [];
  const countsByPrefix: Record<OciFolderPrefix, number> = {
    recebidos: 0,
    'processados/urgentes': 0,
    'processados/rotina': 0,
    auditoria_humana: 0,
    rejeitados: 0,
  };
  let totalBytesUsed = 0;

  for (const prefix of prefixes) {
    const dir = path.join(OCI_VAULT_ROOT, BUCKET_NAME, prefix);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.enc.json'));
    for (const file of files) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as StoredObjectMeta;
        countsByPrefix[prefix] += 1;
        totalBytesUsed += meta.sizeBytes;
        objects.push({
          bucket: meta.bucket,
          objectPath: meta.objectPath,
          prefix: meta.prefix,
          documentoId: meta.documentoId,
          contentType: meta.contentType,
          sizeBytes: meta.sizeBytes,
          sha256Checksum: meta.sha256Checksum,
          encryption: meta.encryption,
          createdAt: meta.createdAt,
          remoteSynced: meta.remoteSynced,
        });
      } catch {
        // Ignora arquivos de metadados corrompidos ou ilegíveis
      }
    }
  }

  objects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    config: getOciConfigStatus(),
    totalBytesUsed,
    countsByPrefix,
    objects,
  };
}

export function readAndVerifyOciObject(objectPath: string): {
  validIntegrity: boolean;
  objectPath: string;
  sha256Checksum: string;
  decryptedPreview: string;
} | null {
  // Bloqueio rigoroso contra tentativa de Path Traversal na leitura de objetos
  const normalized = path.posix.normalize(objectPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.resolve(OCI_VAULT_ROOT, BUCKET_NAME, `${normalized}.enc.json`);
  const rootPrefix = path.resolve(OCI_VAULT_ROOT, BUCKET_NAME) + path.sep;
  if (!fullPath.startsWith(rootPrefix) || !fs.existsSync(fullPath)) {
    return null;
  }

  const meta = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as StoredObjectMeta;
  const decrypted = decryptAtRest(meta.envelope);
  const recomputedHash = computeSha256(decrypted);
  const isText = meta.contentType.includes('json') || meta.contentType.includes('text');
  return {
    validIntegrity: recomputedHash === meta.sha256Checksum,
    objectPath: meta.objectPath,
    sha256Checksum: meta.sha256Checksum,
    decryptedPreview: isText
      ? decrypted.toString('utf8').slice(0, 4000)
      : `[Arquivo binário criptografado (${meta.contentType}), ${meta.sizeBytes} bytes, integridade verificada]`,
  };
}
