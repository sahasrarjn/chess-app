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
export ALERT_EMAIL="you@example.com"   # optional 5xx alarm
chmod +x server/aws/deploy.sh
./server/aws/deploy.sh
```

First run builds the Docker image (compiles Fairy-Stockfish — ~10 min), pushes to ECR, and creates the App Runner service. The backend `API_KEY` is stored in App Runner env vars — **not** in client apps.

Then deploy the Cloudflare worker:

```bash
./server/worker/deploy.sh
```

## Update after code changes

```bash
./server/aws/deploy.sh
./server/worker/deploy.sh
```

## Rotate API key

```bash
./scripts/rotate-api-key.sh
```

No iPhone/web rebuild required. See [SECURITY.md](../../SECURITY.md).

## Billing alarm (optional, us-east-1 only)

```bash
aws cloudformation deploy \
  --stack-name chess-border-billing \
  --template-file server/aws/monitoring.yaml \
  --parameter-overrides AlertEmail=you@example.com MonthlyBudgetUsd=25 \
  --region us-east-1
```

Confirm the SNS subscription email after deploy.

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
