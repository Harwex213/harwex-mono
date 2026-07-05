# Args

`$projectFolder`: "Take project folder from the user input"
`$docsFolder`:  "Take docs folder from the user input"
`$requirements`: "./requirements.md"
`$backlog`: "./ai/backlog.md"
`$current-task`: "./ai/current-task.md"

P.S. Relative paths of `$requirements`, `$backlog` and `$current-task` ties to `$docsFolder`

# Glossary

- Задача. Содержится в `$backlog` и представляет одную небольшую законченную часть работы. Существуют три категории задач: 1) feature - выполнение бизнес требований по checklist, 2) infrastructure - создание необходимой инфраструктуры, которая позволит приступить к feature задаче, 3) tech debt - закрытие технического долга и багов
- Memory. Проект должен иметь memory (документацию) - содержит информацию используемо технологического стека и мотивацию принятых решений, структуру модулей и описание контрактов между модулями (абстрактными слоями)

# Prerequisite Actions. Формируем DoD исходя из requirements

Данный цикл необходим для того, чтобы агент(ы) создали рабочий MVP исходя из крайне недоработанных и недоформулированных требований пользователя из `$requirements`.

- Прочитать `$requirements` - формулирование задачи и требования к software
- Сформулировать `$checklist` - чеклист список Definition of Done для software исходя из `$requirements`
- Создать `$backlog` - первоначальный список задач для выполнения и описания

# Loop

Цикл состоит из трёх агентов. Каждый агент имеет свой собственный контекст и перезапускается, если контекст заполнен на 40%:
1) Backlog & Task Manager
2) Task Implementer
3) Task Reviewer & Bug Detector

## 1 Step. Create a plan to follow (Agent - `Backlog & Task Manager`)

## 1.1 Step. Refine backlog

- Прочитать текущий `$backlog` - список задач для выполнения и описание
- Исходя из списка выполненных задач обновить `$checklist`. Удалить выполненные задачи из `$backlog`
- Отсортировать задачи в порядке важности (первая самая важная)

Step artifact: `$backlog` содержит задачи для выполнения

## 1.2 Step. Formulate DoD for current, one particular, task

- Взять текущую задачу 
- В `$current-task` расписать задачу для выполнения: 1) описание задачи из backlog, 2) списк чеклистов как Definition of Done для задачи

Step artifact: `$current-task` содержит описание текущей задачи и чёткий Definition of Done

## 2 Step. Follow the plan (Agent - `Task Implementer`)

## 2.1 Step. Complete the current task

- Выполнить задачу исходя из требований и DoD, лежащих в `$current-task`

Step artifact: задача выполнена

## 2.2 Step. Retrospective

- Создать/обновить memory в `CLAUDE.md`

Step artifact: файл `CLAUDE.md` обновлён

## 3 Step. Check the implementation (Agent - `Task Reviewer & Bug Detector`)

- Проверить что задача выполнена исходя из DoD в `$current-task`
- Если задача не выполнена, вернуться к `2 Step. Follow the plan`, добавив в конец файла `$current-task` что нужно исправить
- Если задача выполнена, отметить текущую задачу как выполненную в `$backlog`
- Если задача выполнена, очистить `$current-task`, так как текущая задача выполнена

Step artifact: возврат к `2 Step. Follow the plan` ЛИБО файл `$backlog` обновлён, `$current-task` чист
