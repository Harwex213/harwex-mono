using System.IO;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Rebuilds the Crazy Time wheel materials from the values Blender authored.
///
/// FBX cannot carry a Principled BSDF faithfully:
///   * base colour arrives sRGB-encoded, and this project renders in Linear
///     space, so every surface imports a full gamma too bright;
///   * metallic is dropped entirely, which turns the gold parts into pale plastic.
///
/// export_fbx.py writes the authored values to CrazyTimeWheel_materials.json.
/// Run this after every re-export.
/// </summary>
static class CrazyTimeWheelMaterials
{
    const string Json = "Assets/Art/CrazyTimeWheel/CrazyTimeWheel_materials.json";
    const string MaterialDir = "Assets/Art/CrazyTimeWheel/Materials";

    [System.Serializable]
    class Entry
    {
        public string name;
        public float[] baseColor;
        public float metallic;
        public float roughness;
        public float[] emission;
    }

    [System.Serializable]
    class Table { public Entry[] materials; }

    [MenuItem("Tools/Crazy Time Wheel/Apply Blender Materials")]
    static void Apply()
    {
        var path = Path.Combine(Directory.GetCurrentDirectory(), Json);
        if (!File.Exists(path))
        {
            Debug.LogError("Missing " + Json + " - re-run Source~/export_fbx.py.");
            return;
        }

        var table = JsonUtility.FromJson<Table>(File.ReadAllText(path));
        int applied = 0, skipped = 0;

        foreach (var e in table.materials)
        {
            var mat = AssetDatabase.LoadAssetAtPath<Material>(MaterialDir + "/" + e.name + ".mat");
            if (mat == null) { skipped++; continue; }   // material Blender has but the wheel does not use

            // Blender authors in linear, and shader colour properties are stored
            // linear, so these go in untouched.
            mat.SetColor("_BaseColor", new Color(e.baseColor[0], e.baseColor[1], e.baseColor[2], e.baseColor[3]));
            mat.SetFloat("_Metallic", e.metallic);
            mat.SetFloat("_Smoothness", 1f - e.roughness);

            var emission = new Color(e.emission[0], e.emission[1], e.emission[2]);
            bool glows = e.emission[0] > 0f || e.emission[1] > 0f || e.emission[2] > 0f;
            if (glows)
            {
                mat.EnableKeyword("_EMISSION");
                mat.SetColor("_EmissionColor", emission);
                mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            }
            else
            {
                mat.DisableKeyword("_EMISSION");
                mat.SetColor("_EmissionColor", Color.black);
                mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.EmissiveIsBlack;
            }

            EditorUtility.SetDirty(mat);
            applied++;
        }

        AssetDatabase.SaveAssets();
        Debug.LogFormat("Crazy Time wheel: rebuilt {0} materials from Blender ({1} unused entries skipped).",
            applied, skipped);
    }
}
