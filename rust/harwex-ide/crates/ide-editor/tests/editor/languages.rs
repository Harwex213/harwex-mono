//! Highlighting of C, C++, C#, Java and Kotlin: one sample per language with the expected color
//! class of a keyword, a type, a function, a string, a comment and a directive or annotation.

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
