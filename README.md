# Календарь звонков (продолжение)


[![hexlet-check](https://github.com/aputintsev/ai-for-developers-project-387/actions/workflows/hexlet-check.yml/badge.svg)](https://github.com/aputintsev/ai-for-developers-project-387/actions)

[Открыть приложение на Render](https://call-calendar-tx7f.onrender.com)

«Запись на звонок» это упрощённый сервис бронирования времени по мотивам Cal.com.

Cal.com это сервис, где пользователь публикует доступные интервалы, а другой человек выбирает свободное время и бронирует встречу. У нашего приложения тот же базовый сценарий: владелец публикует доступное время для встреч, а другой пользователь выбирает свободный слот и записывается на звонок.

В проекте нет авторизации, личных кабинетов и интеграций с внешними календарями. Функциональность намеренно ограничена, чтобы сосредоточиться на главном.

В результате должно получиться небольшое, но законченное приложение.

Есть два типа пользователей: Владелец и Гость.
Владелец календаря в приложении один и задан заранее. Он заводит типы встреч, у каждого есть название, описание и длительность, и смотрит список предстоящих встреч всех типов.
Гость заходит без регистрации, выбирает тип встречи, открывает календарь на ближайшие 14 дней и записывается на свободный слот. Слот длится столько, сколько выбранный тип встречи. Одно и то же время нельзя занять дважды, даже разными типами встреч.

Окно записи занимает 14 календарных дней и сдвигается с течением времени. Начало с сегодняшнего или завтрашнего дня, часы работы владельца и часовой пояс вы выбираете и записываете в спецификации. Длительность слота совпадает с длительностью типа встречи, шаг доступных стартов тоже фиксируется в спецификации. Пересечение интервалов запрещено, включая частичное наложение разных типов. Следующая встреча может начинаться в момент окончания предыдущей. Правила действуют и для двух запросов, пришедших одновременно.

Данные хранятся в памяти процесса. Перезапуск сбрасывает записи.

Одновременные записи из нескольких вкладок одного профиля браузера координируются через Web Locks. Для этого нужен браузер с поддержкой Web Locks и адрес HTTPS или localhost.

Учебный проект Хекслета: https://ru.hexlet.io/programs/ai-for-developers
Как это должно работать (примеры экранов): https://files.hexlet.app/a/2ipc5m

## Спецификация и решения первого проекта

- [Исходная спецификация прототипа](https://github.com/aputintsev/ai-for-developers-project-386/issues/7)
- [Карта решений первого проекта](https://github.com/aputintsev/ai-for-developers-project-386/issues/1)
- [Словарь предметной области](GLOSSARY.md)
- [Записи архитектурных решений](docs/adr/)
- [Трекер продолжения проекта](https://github.com/aputintsev/ai-for-developers-project-387/issues)

## Стек

- Vite & Typescript - для бэкенда
- shadcn/ui - для фронтенда

Обязательная часть работы с API состоит из TypeSpec-контракта, сгенерированной OpenAPI-спецификации и клиентского SDK для фронтенда. До выбора инструментов проверьте, что для языка фронтенда есть генератор клиента из OpenAPI. Серверные типы и маршруты генерируются, если выбранный фреймворк это поддерживает. При отсутствии серверного генератора бекенд реализуется по контракту и проверяется тестами.

## Установка

```bash
git clone https://github.com/aputintsev/ai-for-developers-project-387.git
cd ai-for-developers-project-387
```

## Использование

Из корня репозитория соберите образ и запустите контейнер.

```sh
docker build -t call-calendar .
docker run -d --name call-calendar -p 127.0.0.1:8080:8080 call-calendar
```

1. Откройте http://localhost:8080, перейдите в раздел Владельца и создайте тип встречи.
2. Вернитесь на главную, нажмите «Записаться» и проверьте, что Гость видит созданный тип встречи.
3. Проверьте ответ API из контейнера. Первая строка должна быть `200`, вторая — JSON-массив с созданным типом встречи.

```sh
docker exec call-calendar node -e 'fetch("http://127.0.0.1:8080/api/meeting-types").then(async (response) => { console.log(response.status); console.log(await response.text()) })'
```

Перезапустите контейнер и повторите запрос к API. После перезапуска он возвращает `200` и пустой массив `[]`, поскольку данные хранятся в памяти процесса.

```sh
docker restart call-calendar
```

Когда закончите проверку, остановите и удалите контейнер.

```sh
docker stop call-calendar
docker rm call-calendar
```

## Подключение Render MCP

Render MCP позволяет проверять состояние сервиса `call-calendar`, смотреть логи
и запускать развёртывание из Codex. Для просмотра приложения подключение не требуется.

1. Откройте репозиторий как доверенный проект в Codex. Из корня репозитория
   скопируйте [шаблон Render MCP](.codex/config.toml.example):

   ```sh
   cp -n .codex/config.toml.example .codex/config.toml
   ```

   Если `.codex/config.toml` уже существует, перенесите в него секции Render из
   шаблона, сохранив остальные настройки.
2. Из корня репозитория запустите вход и подтвердите доступ в браузере.

   ```sh
   codex mcp login render
   ```

   Codex хранит данные OAuth-сессии локально. Ключ API для этого способа
   подключения не нужен. Локальный `.codex/config.toml` исключён из Git.
3. Выполните `codex mcp list` и убедитесь, что `render` включён. Откройте новую
   сессию Codex и попросите вывести список рабочих пространств Render и сервисов
   в пространстве с `call-calendar`.

[Документация Render MCP](https://render.com/docs/mcp-server)

---

<details>
<summary>Автоматические тесты Хекслета</summary>

Тесты запускаются на каждый коммит. За запуск отвечает файл `.github/workflows/hexlet-check.yml` — не удаляйте и не переименовывайте ни его, ни репозиторий.

</details>

## О Хекслете

[Хекслет](https://ru.hexlet.io/) — школа программирования: авторские программы обучения с практикой, поддержкой наставников и реальными проектами, которые остаются в резюме. Этот репозиторий — один из таких проектов.

## OpenCode in GitHub

The `.github/workflows/opencode.yml` workflow answers maintainer requests directly in the discussion where they are posted. It uses the issue and pull request title, body, comments, and inline review comments as context, and follows the GitHub Issues conventions in `docs/agents/issue-tracker.md`. It runs on `issue_comment` and `pull_request_review_comment`, both with `types: [created]`.

A command must be the first thing in a new comment and start with `/oc <request>` or `/opencode <request>`. Only comments from human users are considered: bots are ignored, the author must be `OWNER` or `COLLABORATOR`, and the job re-checks `admin`, `maintain`, or `write` repository permission through `gh api`. Inline review comments are accepted only when the pull request head is a branch in this repository, and `/oc apply patch <comment ID>` is handled by a separate apply job.

The agent runs OpenCode CLI v2.3.2 with `opencode-console/deepseek-v4.1-flash` — DeepSeek V4.1 Flash through OpenCode Console — using the `OPENCODE_API_KEY` Actions secret. Authorization relies on the built-in `GITHUB_TOKEN` with minimal per-job permissions instead of a GitHub App, and the default-branch checkout does not persist credentials.

Runs for the same issue or pull request share a `thread-<number>` concurrency group with `cancel-in-progress: false`, so a new command queues behind the current one instead of interrupting it. Analysis is limited to 8 minutes, while posting the reply and applying a patch each get 2 minutes. The agent may load the `to-spec`, `to-tickets`, and `implement-spec` skills from `.agents/skills/`; every other capability (read, glob, grep) is read-only.

OpenCode V2 no longer shares sessions, so no public session link is created. The result is the reply comment in the original GitHub thread, and run status and logs are available under [OpenCode runs](https://github.com/aputintsev/ai-for-developers-project-387/actions/workflows/opencode.yml).

### Test a PR edit

The draft PR from `test/opencode-patch` into `main` is the test surface.
Use `/oc draft patch <request>` in its conversation to propose a one-line
change to `docs/opencode-patch-test.md`. Review the diff and use the ID at the end
of the proposal comment URL. The repository owner can then post
`/oc apply patch <comment ID>` in the same PR. The apply job commits only to
the test branch and requires the head SHA shown in the proposal to still be
current. Its Actions log links to the commit.

## Development and quality checks

Install [mise](https://mise.jdx.dev/getting-started.html), then from the repository root:

```sh
mise trust
mise install
mise run setup
mise run check
```

`setup` installs npm dependencies from the lockfile, Playwright Chromium, and hk Git hooks.
`check` runs ESLint (warnings fail), secret history scanning, GitHub Actions lint,
Renovate schema validation, TypeScript/Vite build, smoke tests, and OSV vulnerability
scanning. OSV needs network access. GitHub Actions runs this same command on every
push and pull request, and weekly to detect newly published vulnerabilities.
The generated Hexlet workflow is maintained separately.

Before commit, hk checks staged JavaScript/TypeScript and staged secrets. Before
push, it runs `mise run check`. CI remains the gate when hooks are bypassed.
`mise run fix` applies ESLint's available automatic fixes.

```sh
mise run dev        # foreground Vite
mise run dev:start  # background Vite, managed by mise/pitchfork
mise run dev:logs
mise run dev:stop
```

Open http://localhost:5173 after starting the background server. Daemons are an
experimental mise feature; they start only on request. Smoke tests manage their
own isolated Vite server and do not require this background process.

Renovate configuration is in `renovate.json`; enable the Renovate GitHub App for
this repository to receive update PRs. Releases must age seven days before an
update is proposed. The schema in `schemas/renovate.schema.json` is a snapshot of
https://docs.renovatebot.com/renovate-schema.json and must be updated from that
source, not edited manually. Tool versions live in `mise.toml`; npm dependencies
are reproduced by `call-calendar/package-lock.json`.

The npm override for `minimatch` keeps transitive copies on the patched v11 line
(GHSA-g3hv-75wg-m249). Revisit the override when upstream dependencies upgrade.

After editing the API contract in `call-calendar/api/main.tsp`, regenerate OpenAPI
and the TypeScript SDK in order.

```sh
mise run generate:api
```

Browser tests default to Playwright Chromium. Set `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome`
to run them with an existing Google Chrome installation.

## Releases

Release Please processes Conventional Commits on pushes to `main`. It opens or
updates a release PR with the proposed version, changelog, npm package metadata,
lockfile, and release manifest. Merging the release PR lets the next workflow run
create the GitHub release and its `vX.Y.Z` tag.

The first release is `0.1.0`. Subsequent releases use a minor bump for `feat:`, a
patch bump for `fix:`, and a major bump for a breaking change marked with `!` or
a `BREAKING CHANGE:` footer.

The workflow uses the built-in `GITHUB_TOKEN`. A repository administrator must
enable **Allow GitHub Actions to create and approve pull requests** under
**Settings → Actions → General → Workflow permissions** before the workflow can
open a release PR.
