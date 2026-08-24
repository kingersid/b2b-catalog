import { ListObjectsCommand, S3Client } from '@aws-sdk/client-s3';

const ACCOUNT_ID = 'e80e472d0cd0037855bc396a3b7f7d97';
const BUCKET = 'chandni-catalog-assets';

// Create S3-compatible client for R2
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function listR2Objects(prefix = 'designs/original/') {
  const objects = [];
  let continuationToken = undefined;
  
  do {
    const command = new ListObjectsCommand({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });
    
    const response = await s3.send(command);
    if (response.Contents) {
      objects.push(...response.Contents);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  return objects;
}

async function main() {
  try {
    const objects = await listR2Objects();
    console.log(`Total objects in R2: ${objects.length}`);
    objects.forEach(obj => {
      console.log(`  ${obj.Key} (${obj.Size} bytes)`);
    });
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
