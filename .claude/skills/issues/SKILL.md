---
name: issues
description: создает GitHub issues и milestones из файла плана. Использую, когда есть готовый план с фазами и нужно создать бэклог на GitHub. 
---

# Plan Generator

Прочитай план из файла: $ARGUMENTS

Для каждой фазы создай milestone и issues в Github, используя gh cli. 

## Порядок действий

1. Прочитай файл плана.
2. Для каждой фазы создай milestone:
   `gh api repos/{owner}/{repo}/milestones --field title="..."`
3. Для каждой задачи в фазе создай ищущую.
   `gh issue create --title "..." --body "..." --lable "..." --milestone "..."`

## Формат Issue

**Title**: текст задачи из плана (без [])
**Body**: описание задачи
