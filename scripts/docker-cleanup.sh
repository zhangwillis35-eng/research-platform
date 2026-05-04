#!/bin/bash
# ScholarFlow Docker auto-cleanup — run before each build or via cron
# Usage: bash scripts/docker-cleanup.sh

echo "=== Docker Cleanup ==="

# 1. Remove stopped containers
stopped=$(docker ps -aq -f status=exited | wc -l)
if [ "$stopped" -gt 0 ]; then
  docker rm $(docker ps -aq -f status=exited) 2>/dev/null
  echo "Removed $stopped stopped containers"
fi

# 2. Remove dangling images (untagged)
dangling=$(docker images -q -f dangling=true | wc -l)
if [ "$dangling" -gt 0 ]; then
  docker rmi $(docker images -q -f dangling=true) 2>/dev/null
  echo "Removed $dangling dangling images"
fi

# 3. Remove old scholarflow images (keep only latest)
old_images=$(docker images scholarflow-app -q | tail -n +2 | wc -l)
if [ "$old_images" -gt 0 ]; then
  docker images scholarflow-app -q | tail -n +2 | xargs docker rmi 2>/dev/null
  echo "Removed $old_images old scholarflow images"
fi

# 4. Clean build cache
docker builder prune -af --filter "until=24h" 2>/dev/null
echo "Cleaned build cache (>24h)"

# 5. Remove unused volumes
docker volume prune -f 2>/dev/null

# 6. Clean npm/pip cache inside build context
rm -rf /tmp/npm-* /tmp/pip-* 2>/dev/null

# Report
echo ""
echo "Disk usage:"
df -h / | tail -1
echo ""
docker system df
