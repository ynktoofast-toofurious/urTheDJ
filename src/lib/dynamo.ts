import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({
  region: (process.env.AWS_REGION ?? 'us-east-1').trim(),
});

export const dynamo = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const SESSIONS_TABLE = (process.env.DYNAMODB_SESSIONS_TABLE ?? 'urTheDJ_Sessions').trim();
export const REQUESTS_TABLE = (process.env.DYNAMODB_REQUESTS_TABLE ?? 'urTheDJ_Requests').trim();
