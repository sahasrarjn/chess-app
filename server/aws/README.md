# AWS deployment (cost-optimized)

Deploys the Fairy-Stockfish engine to **App Runner** — smallest practical size with **HTTPS included** (required for iPhone).

## Estimated monthly cost (us-east-1, always on)

| Component | ~Cost |
|-----------|-------|
| App Runner 0.25 vCPU + 1 GB | **$5–8** |
| ECR storage (few images) | **< $1** |
| **Total** | **~$6–9/mo** |

Skipped on purpose (too expensive for a personal bot):

- Application Load Balancer (~$16+/mo) + ECS Fargate
- NAT Gateway (~$32+/mo)

## Deploy

```bash
# Optional: protect the API
export API_KEY="$(openssl rand -hex 16)"

chmod +x server/aws/deploy.sh
./server/aws/deploy.sh
```

First run builds the Docker image (compiles Fairy-Stockfish — ~10 min), pushes to ECR, and creates the App Runner service.

Output includes an **HTTPS URL** like `https://xxxxx.us-east-1.awsapprunner.com`. Paste that into the iPhone app **Engine server** field (and **API key** if you set `API_KEY`).

## Update after code changes

```bash
./server/aws/deploy.sh
```

## Tear down

```bash
aws cloudformation delete-stack --stack-name chess-border-engine --region us-east-1
aws ecr delete-repository --repository-name chess-border-engine --force --region us-east-1
```

## Stack outputs

```bash
aws cloudformation describe-stacks \
  --stack-name chess-border-engine \
  --query "Stacks[0].Outputs" \
  --region us-east-1
```
