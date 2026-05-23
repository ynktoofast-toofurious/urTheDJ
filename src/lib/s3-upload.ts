import AWS from 'aws-sdk';
import fs from 'fs';

const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const BUCKET = process.env.AWS_S3_BUCKET!;

export async function uploadToS3(filePath: string, key: string): Promise<string> {
  const fileContent = fs.readFileSync(filePath);
  await s3
    .putObject({
      Bucket: BUCKET,
      Key: key,
      Body: fileContent,
      ContentType: 'audio/mpeg',
      ACL: 'public-read',
    })
    .promise();
  return `https://${BUCKET}.s3.amazonaws.com/${key}`;
}
