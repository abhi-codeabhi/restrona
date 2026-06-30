# Restorna — vanilla Kubernetes manifests

Cloud-neutral, plain Kubernetes YAML. **No cloud-specific annotations** (no AWS
ALB / GCP BackendConfig / Azure ingress hints), so these apply **unchanged** to
any conformant cluster: **EKS, GKE, AKS, k3s, kind, minikube, OpenShift**, etc.

## Contents

| File | What |
|------|------|
| `namespace.yaml` | `restorna` namespace |
| `customer-deployment.yaml` | Customer BFF: 2 replicas, `APP=customer PORT=8080`, resource requests/limits, liveness + readiness probes on `/healthz`, `runAsNonRoot` securityContext |
| `customer-service.yaml` | `ClusterIP` service exposing port 80 → container `http` (8080) |

## Apply

```sh
# Build & make the image available to the cluster first, e.g.:
#   docker build -t restorna:latest .
#   kind load docker-image restorna:latest      # kind
#   minikube image load restorna:latest         # minikube
# or push restorna:latest to a registry your cluster can pull from.

kubectl apply -f namespace.yaml
kubectl apply -f customer-deployment.yaml
kubectl apply -f customer-service.yaml

kubectl -n restorna get pods,svc
kubectl -n restorna port-forward svc/restorna-customer 8080:80
curl localhost:8080/healthz   # -> {"status":"ok"}
```

## Templating the other BFFs

The image is identical for every app — only `APP` (and labels/names) change. To
add waiter / kitchen / billing / ordering, copy `customer-deployment.yaml` +
`customer-service.yaml` and change three things:

1. `metadata.name` and the `app.kubernetes.io/component` label
   (`customer` → `waiter`, `kitchen`, `billing`, `ordering`).
2. The `selector` / `template.metadata.labels` `component` value to match.
3. The container env `APP` value.

Keep `PORT=8080` and the probes/securityContext as-is. For a cleaner workflow,
use the Helm chart in `../helm/restorna` and just override `app` per release:

```sh
helm install restorna-waiter ../helm/restorna --set app=waiter
```

For external exposure, add an `Ingress` (or your platform's preferred mechanism)
on top of the `ClusterIP` Service — kept out of these manifests deliberately so
they stay cloud-neutral.
