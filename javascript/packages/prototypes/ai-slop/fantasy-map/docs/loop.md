# Args

`$checklist`: /Users/aleh_kaportsau/Projects/harwex-mono/javascript/packages/prototypes/ai-slop/fantasy-map/docs/checklist.md
`$requirements`: /Users/aleh_kaportsau/Projects/harwex-mono/javascript/packages/prototypes/ai-slop/fantasy-map/docs/requirements.md
`$backlog`: /Users/aleh_kaportsau/Projects/harwex-mono/javascript/packages/prototypes/ai-slop/fantasy-map/docs/ai/backlog.md
`$current-task`: /Users/aleh_kaportsau/Projects/harwex-mono/javascript/packages/prototypes/ai-slop/fantasy-map/docs/ai/current-task.md

# Loop

Каждый step - запуск нового subagent с пустым контекстом.

Глоссарий:
- Задача. Содержится в `$backlog` и представляет одную небольшую законченную часть работы. Существуют три категории задач: 1) feature - выполнение бизнес требований по checklist, 2) infrastructure - создание необходимой инфраструктуры, которая позволит приступить к feature задаче, 3) tech debt - закрытие технического долга и багов
- Документация. Проект должен иметь документацию - содержит информацию используемо технологического стека и мотивацию принятых решений, структуру модулей и описание контрактов между модулями (абстрактными слоями)

## 1 Step. Управляем бэклогом задач исходя из requirements & checklist

- Прочитать `$requirements` - формулирование задачи и требования к software
- Прочитать `$checklist` - Definition of Done для software
- Прочитать текущий `$backlog` - список задач для выполнения и описание
- Исходя из списка выполненных задач обновить `$checklist`
- Исходя из существующих `$requirements`, `$checklist` и не выполненных задач из `$backlog` составить новые задачи
- Отсортировать задачи в порядке важности (первая самая важная)

Step artifact: `$backlog` содержит задачи для выполнения

## 2 Step. Formulate DoD for current, one particular, task

- Взять текущую задачу 
- В `$current-task` написать списком чеклисты DoD - что нужно сделать для выполнения задачи

Step artifact: `$current-task` содержит описание текущей задачи и чёткий Definition of Done

## 3 Step. Complete the current task

- Выполнить задачу исходя из требований и DoD, лежащих в `$current-task`

Step artifact: задача выполнена

## 4 Step. Retrospective

- Создать/обновить документацию в `CLAUDE.md`

Step artifact: файл `CLAUDE.md` обновлён

## 5 Step. Review

- Проверить что задача выполнена исходя из DoD в `$current-task`
- Если задача не выполнена, вернуться к `3 Step`, уточнив в `$current-task` что нужно исправить
- Если задача выполнена, отметить текущую задачу как выполненную в `$backlog`
- Если задача выполнена, очистить `$current-task`, так как текущая задача выполнена

Step artifact: возврат к 3 Step ЛИБО файл `$backlog` обновлён, `$current-task` чист
