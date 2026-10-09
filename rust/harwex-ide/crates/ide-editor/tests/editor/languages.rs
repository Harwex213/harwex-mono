//! Highlighting of C, C++, C#, Java, Kotlin and GLSL: one sample per language with the expected
//! color class of a keyword, a type, a function, a string, a comment and a directive or annotation.
//! Also JSON keys and the `code spans` of Markdown and plain text.

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
        .map(|s| (text[s.start as usize..s.end as usize].to_string(), s.kind))
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
