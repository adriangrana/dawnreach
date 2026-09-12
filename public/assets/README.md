# Dawnreach art pipeline

POC 0.1 deliberately runs without external art so movement can be tested immediately.

When final generated assets are ready, place them under these paths:

```text
public/assets/
  maps/
    poc-arena.webp
  heroes/
    alden/
      portrait.webp
      idle/
      walk/
      attack/
      cast/
      death/
  effects/
    move-marker/
```

The first art milestone is one arena background plus Alden's idle/walk sprites. The code should only move to combat after character consistency has been validated in motion.
