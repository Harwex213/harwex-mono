//! Highlighting of C, C++, C#, Java, Kotlin and GLSL: one sample per language with the expected
//! color class of a keyword, a type, a function, a string, a comment and a directive or annotation.
//! Also JSON keys, the `code spans` of Markdown and plain text, YAML, Dockerfile and config files.

use std::path::Path;

use ide_editor::{Document, HlKind, Language};

const UNREAL_HEADER: &str = r#"// Copyright Epic Games, Inc. All Rights Reserved.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "MyActor.generated.h"

UCLASS(Blueprintable, ClassGroup=(Custom), meta=(BlueprintSpawnableComponent))
class MYGAME_API AMyActor : public AActor
{
	GENERATED_BODY()

public:
	AMyActor();

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Stats")
	float Health = 100.f;

	UPROPERTY(VisibleAnywhere)
	TArray<FString> Names;

	UFUNCTION(BlueprintCallable, Category = "Stats")
	void Heal(float Amount);

protected:
	virtual void BeginPlay() override;

private:
	int32 Counter = 0;
};

USTRUCT(BlueprintType)
struct FMyData
{
	GENERATED_BODY()

	UPROPERTY()
	int32 Value = 0;
};

UENUM()
enum class EMyState : uint8
{
	Idle,
	Running,
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnHealed, float, Amount);

inline int Twice(int X) { return X * 2; }
"#;

const C_SAMPLE: &str = r#"#include <stdio.h>
#define MAX_LEN 64

/* Block comment. */
typedef struct Point { int x; int y; } Point;

static int add(int a, int b) {
    char c = '\n';
    return a + b; // line comment
}

int main(void) {
    printf("%d\n", add(1, 2));
    return 0;
}
"#;

const CPP_SAMPLE: &str = r#"#include <vector>
#define SQUARE(x) ((x) * (x))

namespace demo {
template <typename T>
class Box final {
public:
    explicit Box(T value) : value_(value) {}
    T get() const noexcept { return value_; }
private:
    T value_;
};
}

int main() {
    auto box = demo::Box<int>(42);
    std::vector<std::string> names{"a", R"(raw)"};
    if (box.get() > 0 && names.empty() == false) { return SQUARE(2); } // done
    return nullptr == nullptr ? 0 : 1;
}
"#;

const CSHARP_SAMPLE: &str = r#"using UnityEngine;

#region Movement
namespace Game.Player
{
    /// <summary>Moves the player.</summary>
    [RequireComponent(typeof(Rigidbody))]
    public class PlayerController : MonoBehaviour
    {
        [SerializeField] private float speed = 5.0f;

        void Update()
        {
            var input = Input.GetAxis("Horizontal"); // read input
            Move(input * speed);
        }

        private void Move(float delta) { transform.Translate(delta, 0, 0); }
    }
}
#endregion
"#;

const JAVA_SAMPLE: &str = r#"package com.example;

import java.util.List;

/** A greeter. */
public class Greeter implements Runnable {
    private static final int MAX = 10;

    @Override
    public void run() {
        String name = "world"; // a name
        System.out.println(greet(name));
    }

    static String greet(String who) { return "Hello, " + who; }
}
"#;

const KOTLIN_SAMPLE: &str = r#"package com.example

import kotlin.math.max

/* A greeter. */
data class Greeter(val name: String) {
    @JvmStatic
    fun greet(times: Int): String {
        val n = max(times, 1) // at least once
        return "Hello, $name".repeat(n)
    }
}

fun main() {
    println(Greeter("world").greet(2))
}
"#;

fn kinds_on_line(doc: &mut Document, line: usize) -> Vec<(String, HlKind)> {
    let text = doc.line(line);
    let spans = doc.highlight(line..line + 1).remove(0);
    spans
        .iter()
        // A span may run into the line break, which `line` leaves out.
        .map(|s| (text[s.start as usize..(s.end as usize).min(text.len())].to_string(), s.kind))
        .collect()
}

/// Asserts `(line, token, kind)` triples on `text` parsed as `lang`.
fn expect(lang: Language, text: &str, cases: &[(usize, &str, HlKind)]) {
    let mut doc = Document::from_text(text, lang);
    doc.wait_syntax();
    for &(line, token, kind) in cases {
        let got = kinds_on_line(&mut doc, line);
        assert!(
            got.contains(&(token.to_string(), kind)),
            "{lang:?} line {line}: want {token:?} as {kind:?}, got {got:?}"
        );
    }
}

#[test]
fn extensions_map_to_languages() {
    let cases = [
        ("a.c", Language::C),
        ("a.h", Language::Cpp),
        ("a.H", Language::Cpp),
        ("a.cc", Language::Cpp),
        ("a.cpp", Language::Cpp),
        ("a.cxx", Language::Cpp),
        ("a.c++", Language::Cpp),
        ("a.hh", Language::Cpp),
        ("a.hpp", Language::Cpp),
        ("a.hxx", Language::Cpp),
        ("a.h++", Language::Cpp),
        ("a.inl", Language::Cpp),
        ("a.ipp", Language::Cpp),
        ("a.tpp", Language::Cpp),
        ("a.cs", Language::CSharp),
        ("a.csx", Language::CSharp),
        ("a.java", Language::Java),
        ("a.kt", Language::Kotlin),
        ("a.kts", Language::Kotlin),
        // No Objective-C grammar: its parser is as big as the C# one.
        ("a.m", Language::Plain),
        ("a.mm", Language::Plain),
    ];
    for (name, lang) in cases {
        assert_eq!(Language::from_path(Path::new(name)), lang, "{name}");
    }
    let names: Vec<_> = [
        Language::C,
        Language::Cpp,
        Language::CSharp,
        Language::Java,
        Language::Kotlin,
    ]
    .map(Language::name)
    .into();
    assert_eq!(names, ["C", "C++", "C#", "Java", "Kotlin"]);
}

#[test]
fn comment_toggle_uses_line_comments() {
    for lang in [
        Language::C,
        Language::Cpp,
        Language::CSharp,
        Language::Java,
        Language::Kotlin,
    ] {
        assert_eq!(lang.comment_tokens(), Some(("//", "")), "{lang:?}");
        let mut doc = Document::from_text("int x = 1;\n", lang);
        let mut sel = ide_editor::Selection::caret(0);
        ide_editor::editing::toggle_comment(&mut doc, &mut sel);
        assert_eq!(doc.text(), "// int x = 1;\n", "{lang:?}");
    }
}

#[test]
fn c_kinds() {
    use HlKind::*;
    expect(
        Language::C,
        C_SAMPLE,
        &[
            (0, "#include", Keyword),
            (0, "<stdio.h>", String),
            (1, "MAX_LEN", Macro),
            (3, "/* Block comment. */", Comment),
            (4, "typedef", Keyword),
            (4, "Point", Type),
            (6, "add", Function),
            (6, "int", Type),
            (7, "\\n", Escape),
            (8, "// line comment", Comment),
            (12, "printf", Function),
            (13, "0", Number),
        ],
    );
}

#[test]
fn cpp_kinds() {
    use HlKind::*;
    expect(
        Language::Cpp,
        CPP_SAMPLE,
        &[
            (0, "#include", Keyword),
            (1, "SQUARE", Macro),
            (4, "template", Keyword),
            (4, "T", Type),
            (5, "class", Keyword),
            (5, "Box", Type),
            (6, "public", Keyword),
            (8, "get", Function),
            (8, "noexcept", Keyword),
            (15, "auto", Type),
            (16, "\"a\"", String),
            (16, "R\"(raw)\"", String),
            (17, "empty", Function),
            (17, "false", Builtin),
            (17, "SQUARE", Macro),
            (17, "// done", Comment),
            (18, "nullptr", Constant),
        ],
    );
}

/// An Unreal header: `UCLASS(...)` has no `;` and `MYGAME_API` sits between `class` and the name,
/// so tree-sitter-cpp recovers the class as a function. The macros, the class name and the code
/// after the class still get their colors.
#[test]
fn unreal_header_kinds() {
    use HlKind::*;
    expect(
        Language::Cpp,
        UNREAL_HEADER,
        &[
            (1, "#pragma", Keyword),
            (5, "\"MyActor.generated.h\"", String),
            (7, "UCLASS", Macro),
            (8, "class", Keyword),
            (8, "MYGAME_API", Macro),
            (8, "AMyActor", Type),
            (10, "GENERATED_BODY", Macro),
            (12, "public", Keyword),
            (15, "UPROPERTY", Macro),
            (15, "\"Stats\"", String),
            (16, "float", Type),
            (16, "100.f", Number),
            (22, "Heal", Function),
            (25, "virtual", Keyword),
            (25, "override", Keyword),
            // After the class the parse is clean again.
            (31, "USTRUCT", Macro),
            (32, "struct", Keyword),
            (32, "FMyData", Type),
            (34, "GENERATED_BODY", Macro),
            (36, "UPROPERTY", Macro),
            (37, "int32", Type),
            (37, "Value", Property),
            (41, "enum", Keyword),
            (41, "EMyState", Type),
            (47, "DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam", Macro),
            (49, "inline", Keyword),
            (49, "Twice", Function),
            (49, "return", Keyword),
        ],
    );
}

#[test]
fn csharp_kinds() {
    use HlKind::*;
    expect(
        Language::CSharp,
        CSHARP_SAMPLE,
        &[
            (0, "using", Keyword),
            (2, "#region", Keyword),
            (3, "namespace", Keyword),
            (5, "/// <summary>Moves the player.</summary>", Comment),
            (6, "RequireComponent", Attribute),
            (6, "Rigidbody", Type),
            (7, "public", Keyword),
            (7, "PlayerController", Type),
            (7, "MonoBehaviour", Type),
            (9, "SerializeField", Attribute),
            (9, "float", Type),
            (9, "5.0f", Number),
            (11, "Update", Function),
            (13, "var", Keyword),
            (13, "GetAxis", Function),
            (13, "\"Horizontal\"", String),
            (13, "// read input", Comment),
            (14, "Move", Function),
            (17, "delta", Parameter),
            (20, "#endregion", Keyword),
        ],
    );
}

#[test]
fn java_kinds() {
    use HlKind::*;
    expect(
        Language::Java,
        JAVA_SAMPLE,
        &[
            (0, "package", Keyword),
            (2, "import", Keyword),
            (4, "/** A greeter. */", Comment),
            (5, "class", Keyword),
            (5, "Greeter", Type),
            (5, "Runnable", Type),
            (6, "int", Type),
            (6, "MAX", Constant),
            (6, "10", Number),
            (8, "@Override", Attribute),
            (9, "run", Function),
            (10, "\"world\"", String),
            (10, "// a name", Comment),
            (11, "println", Function),
            (14, "greet", Function),
        ],
    );
}

#[test]
fn kotlin_kinds() {
    use HlKind::*;
    expect(
        Language::Kotlin,
        KOTLIN_SAMPLE,
        &[
            (0, "package", Keyword),
            (2, "import", Keyword),
            (4, "/* A greeter. */", Comment),
            (5, "data", Keyword),
            (5, "class", Keyword),
            (5, "Greeter", Type),
            (6, "@JvmStatic", Attribute),
            (7, "fun", Keyword),
            (7, "greet", Function),
            (7, "times", Parameter),
            (7, "Int", Type),
            (8, "val", Keyword),
            (8, "max", Function),
            (8, "1", Number),
            (8, "// at least once", Comment),
            (9, "\"Hello, ", String),
            (13, "main", Function),
        ],
    );
}

const GLSL_SAMPLE: &str = r#"#version 450
#extension GL_ARB_separate_shader_objects : enable

layout(location = 0) in vec3 inPos;
layout(binding = 1) uniform sampler2D tex;
out vec4 fragColor;
uniform highp float time; // seconds

float pulse(in float t) {
    return 0.5 + 0.5 * sin(t * 3.0);
}

void main() {
    vec4 c = texture(tex, inPos.xy);
    fragColor = c * pulse(time);
    gl_Position = vec4(inPos, 1.0);
}
"#;

#[test]
fn glsl_extensions_and_kinds() {
    for ext in ["glsl", "vert", "frag", "geom", "comp", "tesc", "tese", "FRAG"] {
        assert_eq!(Language::from_path(Path::new(&format!("a.{ext}"))), Language::Glsl, "{ext}");
    }
    assert_eq!(Language::Glsl.name(), "GLSL");
    assert_eq!(Language::Glsl.comment_tokens(), Some(("//", "")));
    use HlKind::*;
    expect(
        Language::Glsl,
        GLSL_SAMPLE,
        &[
            (0, "#version", Keyword),
            (1, "#extension", Keyword),
            (1, "enable", Keyword),
            (3, "layout", Keyword),
            (3, "location", Attribute),
            (3, "0", Number),
            (3, "in", Keyword),
            (3, "vec3", Type),
            (4, "uniform", Keyword),
            (4, "sampler2D", Type),
            (5, "out", Keyword),
            (6, "highp", Keyword),
            (6, "float", Type),
            (6, "// seconds", Comment),
            (8, "pulse", Function),
            (9, "return", Keyword),
            (9, "sin", Function),
            (13, "texture", Function),
            (15, "gl_Position", Builtin),
        ],
    );
}

const JSON_SAMPLE: &str = r#"{
  "name": "demo",
  "version": 2,
  "private": true,
  "main": null,
  "nested": { "key\tx": [1.5, false] }
}
"#;

/// Keys get the property color and values keep theirs, as in IDEA. `tsconfig.json` with
/// comments goes through the same grammar.
#[test]
fn json_keys_differ_from_string_values() {
    use HlKind::*;
    for text in [JSON_SAMPLE.to_string(), JSON_SAMPLE.replacen("{\n", "{\n  // a comment\n", 1)] {
        let shift = usize::from(text.contains("//"));
        let mut cases = vec![
            (1 + shift, "\"name\"", Property),
            (1 + shift, "\"demo\"", String),
            (2 + shift, "\"version\"", Property),
            (2 + shift, "2", Number),
            (3 + shift, "true", Builtin),
            (4 + shift, "null", Builtin),
            (5 + shift, "\"key", Property),
            (5 + shift, "\\t", Escape),
            (5 + shift, "1.5", Number),
            (5 + shift, "false", Builtin),
        ];
        if shift == 1 {
            cases.push((1, "// a comment", Comment));
        }
        expect(Language::Json, &text, &cases);
    }
    assert_eq!(Language::from_path(Path::new("tsconfig.json")), Language::Json);
    assert_eq!(Language::from_path(Path::new("a.jsonc")), Language::Json);
}

const MARKDOWN_SAMPLE: &str = r#"# Use `cargo` here

Run `cargo test` and ``a ` b`` then \`no` code.
- item with `x`

```rust
let `y` = 1;
```

| col `a` | b |
|---------|---|
"#;

/// Markdown and plain text paint backtick code spans as `InlineCode`, backticks included. A
/// fenced block is not scanned.
#[test]
fn inline_code_in_markdown_and_plain_text() {
    use HlKind::*;
    let md = MARKDOWN_SAMPLE;
    expect(
        Language::Markdown,
        md,
        &[
            (0, "`cargo`", InlineCode),
            (2, "`cargo test`", InlineCode),
            (2, "``a ` b``", InlineCode),
            (3, "`x`", InlineCode),
            (9, "`a`", InlineCode),
        ],
    );
    let mut doc = Document::from_text(md, Language::Markdown);
    doc.wait_syntax();
    let line2 = kinds_on_line(&mut doc, 2);
    assert!(!line2.iter().any(|(t, _)| t.contains("no")), "an escaped backtick opens nothing: {line2:?}");
    // The fenced line's String span runs into the line break, so read the kinds only.
    let fenced = doc.highlight(6..7).remove(0);
    assert!(!fenced.iter().any(|s| s.kind == InlineCode), "{fenced:?}");

    let txt = "Call `make install` first.\nNo span ` here.\n";
    expect(Language::Plain, txt, &[(0, "`make install`", InlineCode)]);
    let mut doc = Document::from_text(txt, Language::Plain);
    assert_eq!(kinds_on_line(&mut doc, 1), vec![]);
    // Runs of different lengths never pair.
    let mut doc = Document::from_text("``make install` x\n", Language::Plain);
    assert_eq!(kinds_on_line(&mut doc, 0), vec![]);
}

#[test]
fn yaml_dockerfile_conf_file_names() {
    let cases = [
        ("a.yaml", Language::Yaml),
        ("a.YML", Language::Yaml),
        ("pnpm-lock.yaml", Language::Yaml),
        (".github/workflows/ci.yml", Language::Yaml),
        (".clang-format", Language::Yaml),
        (".clang-tidy", Language::Yaml),
        (".yamllint", Language::Yaml),
        ("Dockerfile", Language::Dockerfile),
        ("dockerfile", Language::Dockerfile),
        ("Dockerfile.dev", Language::Dockerfile),
        ("api.Dockerfile", Language::Dockerfile),
        ("api.dockerfile", Language::Dockerfile),
        ("Containerfile", Language::Dockerfile),
        ("Containerfile.prod", Language::Dockerfile),
        ("nginx.conf", Language::Conf),
        ("setup.cfg", Language::Conf),
        ("tox.ini", Language::Conf),
        ("app.properties", Language::Conf),
        ("prod.env", Language::Conf),
        (".env", Language::Conf),
        (".env.local", Language::Conf),
        (".env.production", Language::Conf),
        (".editorconfig", Language::Conf),
        (".gitconfig", Language::Conf),
        (".gitmodules", Language::Conf),
        (".npmrc", Language::Conf),
        (".yarnrc", Language::Conf),
        // Not a Dockerfile variant, and not a dotenv file.
        ("Dockerfile.json", Language::Json),
        ("my.envelope", Language::Plain),
        ("environment", Language::Plain),
    ];
    for (name, lang) in cases {
        assert_eq!(Language::from_path(Path::new(name)), lang, "{name}");
    }
    let names = [Language::Yaml, Language::Dockerfile, Language::Conf].map(Language::name);
    assert_eq!(names, ["YAML", "Dockerfile", "Config"]);
    for lang in [Language::Yaml, Language::Dockerfile, Language::Conf] {
        assert_eq!(lang.comment_tokens(), Some(("#", "")), "{lang:?}");
        let mut doc = Document::from_text("a: 1\n", lang);
        let mut sel = ide_editor::Selection::caret(0);
        ide_editor::editing::toggle_comment(&mut doc, &mut sel);
        assert_eq!(doc.text(), "# a: 1\n", "{lang:?}");
        // Not plain text any more, so backticks get no code-span background.
        let mut doc = Document::from_text("RUN echo `date`\n", lang);
        doc.wait_syntax();
        assert!(!doc.highlight(0..1)[0].iter().any(|s| s.kind == HlKind::InlineCode), "{lang:?}");
    }
}

const YAML_SAMPLE: &str = r#"%YAML 1.2
---
# CI workflow
name: CI
on:
  push:
    branches: [main, "release/*"]
defaults: &defaults
  retries: 3
  ratio: 1.5
  enabled: true
  empty: null
  tagged: !!str 42
  when: 2001-12-14
job:
  <<: *defaults
  script: |
    echo "not a key: here"
  "quoted key": 'single'
  escaped: "tab\there"
  1: one
  flow: {a: 1, 'b': x}
...
"#;

/// Keys get the JSON key color, also a key that reads as a number. Values keep their own kind.
#[test]
fn yaml_kinds() {
    use HlKind::*;
    expect(
        Language::Yaml,
        YAML_SAMPLE,
        &[
            (0, "%YAML 1.2", Keyword),
            (1, "---", Keyword),
            (2, "# CI workflow", Comment),
            (3, "name", Property),
            (3, "CI", String),
            (4, "on", Property),
            (6, "branches", Property),
            (6, "main", String),
            (6, "\"release/*\"", String),
            (7, "&defaults", Type),
            (8, "3", Number),
            (9, "1.5", Number),
            (10, "true", Builtin),
            (11, "null", Builtin),
            (12, "!!str", Keyword),
            (12, "42", Number),
            (13, "2001-12-14", String),
            (15, "<<", Property),
            (15, "*defaults", Type),
            (17, "    echo \"not a key: here\"", String),
            (18, "\"quoted key\"", Property),
            (18, "'single'", String),
            (19, "\\t", Escape),
            (20, "1", Property),
            (21, "a", Property),
            (21, "'b'", Property),
            (21, "x", String),
            (22, "...", Keyword),
        ],
    );
}

/// A YAML file over the tree's line limit is colored line by line, with the same kinds as the
/// tree, except inside a block scalar (line 17), which a line alone cannot tell apart.
#[test]
fn yaml_without_tree_past_the_line_limit() {
    use HlKind::*;
    let mut text = YAML_SAMPLE.to_string();
    for i in 0..Language::YAML_MAX_TREE_LINES {
        text.push_str(&format!("k{i}: v\n"));
    }
    let mut doc = Document::from_text(&text, Language::Yaml);
    doc.wait_syntax();
    assert!(doc.syntax_tree().is_none(), "no tree past the limit");
    expect(
        Language::Yaml,
        &text,
        &[
            (0, "%YAML 1.2", Keyword),
            (1, "---", Keyword),
            (2, "# CI workflow", Comment),
            (3, "name", Property),
            (3, "CI", String),
            (4, "on", Property),
            (6, "branches", Property),
            (6, "main", String),
            (6, "\"release/*\"", String),
            (7, "&defaults", Type),
            (8, "3", Number),
            (9, "1.5", Number),
            (10, "true", Builtin),
            (11, "null", Builtin),
            (12, "!!str", Keyword),
            (12, "42", Number),
            (13, "2001-12-14", String),
            (15, "<<", Property),
            (15, "*defaults", Type),
            (18, "\"quoted key\"", Property),
            (18, "'single'", String),
            (19, "\\t", Escape),
            (20, "1", Property),
            (21, "a", Property),
            (21, "'b'", Property),
            (21, "x", String),
            (22, "...", Keyword),
            (23, "k0", Property),
        ],
    );
    // Lockfile lines: a quoted key, a flow mapping with a comment after it, a version string.
    let lines = [
        "  '@scope/pkg@1.0.0':",
        "    resolution: {integrity: sha512-abc==} # pinned",
        "      debug: 4.3.4",
        "  - name: x",
    ];
    let lock = format!("{}{}", lines.join("\n"), "\nk: v".repeat(Language::YAML_MAX_TREE_LINES));
    expect(
        Language::Yaml,
        &lock,
        &[
            (0, "'@scope/pkg@1.0.0'", Property),
            (1, "resolution", Property),
            (1, "integrity", Property),
            (1, "sha512-abc==", String),
            (1, "# pinned", Comment),
            (2, "4.3.4", String),
            (3, "name", Property),
        ],
    );
}

const DOCKERFILE_SAMPLE: &str = r#"# syntax=docker/dockerfile:1
ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
ENV PATH="/app/bin:$PATH" mode=prod
COPY --from=builder --chown=node:node package.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
RUN <<EOT
apt-get update
EOT
EXPOSE 8080/tcp
LABEL org.opencontainers.image.title='demo'
ENTRYPOINT ["node", "server\tjs"]
CMD echo $home
"#;

/// Instructions are keywords, `${VAR}` one token, flags and pair names properties, the stage
/// name a type and a heredoc a string. The shell after `RUN` stays plain.
#[test]
fn dockerfile_kinds() {
    use HlKind::*;
    expect(
        Language::Dockerfile,
        DOCKERFILE_SAMPLE,
        &[
            (0, "# syntax=docker/dockerfile:1", Comment),
            (1, "ARG", Keyword),
            (1, "NODE_VERSION", Property),
            (2, "FROM", Keyword),
            (2, "${NODE_VERSION}", Constant),
            (2, "AS", Keyword),
            (2, "builder", Type),
            (3, "WORKDIR", Keyword),
            (4, "ENV", Keyword),
            (4, "PATH", Property),
            (4, "$PATH", Constant),
            (4, "mode", Property),
            (5, "COPY", Keyword),
            (5, "--from=builder", Property),
            (5, "--chown=node:node", Property),
            (6, "RUN", Keyword),
            (6, "--mount=type=cache,target=/root/.npm", Property),
            (7, "<<EOT", Keyword),
            (8, "apt-get update", String),
            (9, "EOT", Keyword),
            (10, "EXPOSE", Keyword),
            (10, "8080/tcp", Number),
            (11, "LABEL", Keyword),
            (11, "org.opencontainers.image.title", Property),
            (11, "'demo'", String),
            (12, "ENTRYPOINT", Keyword),
            (12, "\"node\"", String),
            (12, "\\t", Escape),
            (13, "CMD", Keyword),
        ],
    );
    let mut doc = Document::from_text(DOCKERFILE_SAMPLE, Language::Dockerfile);
    doc.wait_syntax();
    let run = kinds_on_line(&mut doc, 6);
    assert!(!run.iter().any(|(t, _)| t.contains("npm ci")), "the shell stays plain: {run:?}");
}

const INI_SAMPLE: &str = r#"; global settings
root = true

[*.{js,ts}]
indent_size = 2
trim_trailing_whitespace = false
[remote "origin"]
	url = git@github.com:a/b.git
name: "Ann \"A\" Lee"   # inline
install_requires =
    requests
export API_URL=https://x.io/${STAGE}/v1
timeout 30s
ratio=-1.5
"#;

/// INI, gitconfig, properties and dotenv lines: comments, sections, keys before `=`, `:` or a
/// space, strings with escapes, variables, numbers and booleans.
#[test]
fn conf_ini_kinds() {
    use HlKind::*;
    expect(
        Language::Conf,
        INI_SAMPLE,
        &[
            (0, "; global settings", Comment),
            (1, "root", Property),
            (1, "true", Builtin),
            (3, "[*.{js,ts}]", Keyword),
            (4, "indent_size", Property),
            (4, "2", Number),
            (5, "false", Builtin),
            (6, "[remote ", Keyword),
            (6, "\"origin\"", String),
            (6, "]", Keyword),
            (7, "url", Property),
            (8, "name", Property),
            (8, "\"Ann ", String),
            (8, "\\\"", Escape),
            (8, "# inline", Comment),
            (9, "install_requires", Property),
            (11, "export", Keyword),
            (11, "API_URL", Property),
            (11, "${STAGE}", Constant),
            (12, "timeout", Property),
            (12, "30s", Number),
            (13, "ratio", Property),
            (13, "-1.5", Number),
        ],
    );
    // An indented line without `=`, `;` or `{` continues the value above it.
    let mut doc = Document::from_text(INI_SAMPLE, Language::Conf);
    assert_eq!(kinds_on_line(&mut doc, 10), vec![]);
}

const NGINX_SAMPLE: &str = r#"# nginx
worker_processes auto;
http {
    server { listen 80; server_name example.com; }
    server {
        listen 443 ssl;
        gzip on;
        location /api {
            proxy_pass http://127.0.0.1:8080;
            proxy_set_header Host $host;
            return 301 "https://$host$request_uri";
        }
    }
}
"#;

/// nginx: directives are keys, also after `{` and `;` on one line; `$variables`, numbers and
/// `on`/`off`.
#[test]
fn conf_nginx_kinds() {
    use HlKind::*;
    expect(
        Language::Conf,
        NGINX_SAMPLE,
        &[
            (0, "# nginx", Comment),
            (1, "worker_processes", Property),
            (2, "http", Property),
            (3, "server", Property),
            (3, "listen", Property),
            (3, "80", Number),
            (3, "server_name", Property),
            (5, "listen", Property),
            (5, "443", Number),
            (6, "gzip", Property),
            (6, "on", Builtin),
            (7, "location", Property),
            (8, "proxy_pass", Property),
            (9, "$host", Constant),
            (10, "return", Property),
            (10, "301", Number),
            (10, "\"https://", String),
            (10, "$host$request_uri", Constant),
        ],
    );
    let mut doc = Document::from_text(NGINX_SAMPLE, Language::Conf);
    let line = kinds_on_line(&mut doc, 3);
    assert!(!line.iter().any(|(t, _)| t.contains("example")), "{line:?}");
}
