import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

dotenv.config();

const s3BucketName = process.env.S3_BUCKET_NAME;

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});

export async function generatePresignedUrl(objectKey: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: s3BucketName,
    Key: objectKey,
  });

  try {
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 86400 });
    return signedUrl;
  } catch (err) {
    console.error('Error generating pre-signed URL:', err);
    throw err;
  }
}

export async function checkObjectExists(objectKey: string): Promise<boolean> {
  const command = new HeadObjectCommand({
    Bucket: s3BucketName,
    Key: objectKey,
  });

  try {
    await s3Client.send(command);
    return true;
  } catch (err: any) {
    if (err.name === 'NotFound') {
      return false;
    }
    throw err;
  }
}

export function getBucketName(): string {
  if (!s3BucketName) {
    throw new Error('S3_BUCKET_NAME environment variable is not set');
  }
  return s3BucketName;
}
