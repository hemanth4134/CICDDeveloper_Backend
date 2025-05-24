import * as cdk from 'aws-cdk-lib';
import * as sdk from 'aws-sdk';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class CicdDeveloperBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Load the GitHub token secret
    const githubTokenSecret = secretsmanager.Secret.fromSecretNameV2(this, 'GitHubTokenSecret', 'hemanthgithubtoken');

    // DynamoDB Table
    const table = new dynamodb.Table(this, 'ProvisioningRequests', {
      partitionKey: { name: 'requestId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // IAM Role for Lambda
    const lambdaRole = new iam.Role(this, 'DynamicLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'));

    // Lambda function
    const provisioner = new lambda.Function(this, 'ServiceProvisionerLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const AWS = require("aws-sdk");
        const { v4: uuidv4 } = require("uuid");
        const ddb = new AWS.DynamoDB.DocumentClient();
        const apigw = new AWS.APIGateway();
        const s3 = new AWS.S3();

        exports.handler = async (event) => {
          const body = JSON.parse(event.body);
          const requestId = uuidv4();
          const item = { requestId, ...body };

          await ddb.put({ TableName: process.env.TABLE_NAME, Item: item }).promise();

          const results = { requestId };

          if (body.services.includes("s3")) {
            const bucketName = \`demo-bucket-\${requestId}\`;
            await s3.createBucket({ Bucket: bucketName }).promise();
            results.s3Bucket = bucketName;
          }

          if (body.services.includes("apigateway")) {
            const restApi = await apigw.createRestApi({ name: \`API-\${requestId}\` }).promise();
            results.apiGatewayId = restApi.id;
          }

          return {
            statusCode: 200,
            headers: {
              "Access-Control-Allow-Origin": "https://master.d3opo2tk5q8iha.amplifyapp.com",
              "Access-Control-Allow-Headers": "Content-Type",
              "Access-Control-Allow-Methods": "OPTIONS,POST"
            },
            body: JSON.stringify(results),
          };
        };
      `),
      environment: {
        TABLE_NAME: table.tableName,
      },
      role: lambdaRole,
      timeout: cdk.Duration.minutes(2),
    });

    table.grantWriteData(provisioner);

    // API Gateway
    const api = new apigateway.LambdaRestApi(this, 'DynamicProvisioningAPI', {
      handler: provisioner,
      proxy: false,
    });

    const submit = api.root.addResource('submit');

    submit.addMethod('POST', new apigateway.LambdaIntegration(provisioner, {
      proxy: true,
    }), {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
          },
        },
      ],
    });

    submit.addCorsPreflight({
      allowOrigins: ['https://master.d3opo2tk5q8iha.amplifyapp.com'],
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    });
  }
}
