import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({
  region: (process.env.AWS_REGION ?? 'us-east-1').trim(),
  ...(process.env.AWS_ACCESS_KEY_ID && {
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
      secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY ?? '').trim(),
    },
  }),
});

export const dynamo = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const SESSIONS_TABLE = (process.env.DYNAMODB_SESSIONS_TABLE ?? 'urTheDJ_Sessions').trim();
export const REQUESTS_TABLE = (process.env.DYNAMODB_REQUESTS_TABLE ?? 'urTheDJ_Requests').trim();
