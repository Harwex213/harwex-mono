using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// <summary>
/// Builds <c>Assets/Scenes/GoldenLuck_SlotMachine_Test.unity</c>: the machine, a neutral floor, a
/// three-light setup and a driver that spins it on a timer.
///
/// Like the prefab builder, this script is the source of truth rather than the scene file, so
/// rerunning <c>GameShow/Slot Machine/Rebuild Test Scene</c> gives the same scene back. It never
/// touches SampleScene.
///
/// The lighting is deliberately a studio rig rather than a skybox: the cabinet is near-black lacquer
/// and polished gold, and both only read when there is a defined key direction and something for the
/// gold to reflect. The project's own StudioReflectionProbe is used as that something.
/// </summary>
public static class SlotMachineTestSceneBuilder
{
    private const string ScenePath = "Assets/Scenes/GoldenLuck_SlotMachine_Test.unity";
    private const string PrefabPath = "Assets/Prefabs/GoldenLuck_SlotMachine.prefab";
    private const string FloorMaterialPath = "Assets/Art/SlotMachine/Materials/MAT_Test_Floor.mat";
    private const string ProfilePath = "Assets/Settings/SampleSceneProfile.asset";
    private const string ReflectionPath = "Assets/Settings/StudioReflectionProbe.exr";

    [MenuItem("GameShow/Slot Machine/Rebuild Test Scene")]
    public static void Rebuild()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        if (prefab == null)
        {
            Debug.LogError("[SlotScene] no prefab at " + PrefabPath + "; run Rebuild Prefab first.");
            return;
        }

        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        BuildEnvironment();
        BuildFloor();
        BuildLights();
        var camera = BuildCamera();
        BuildPostProcessing();

        var machine = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        machine.transform.position = Vector3.zero;
        machine.transform.rotation = Quaternion.identity;

        BuildEventSystem();
        BuildDriver(machine);

        EditorSceneManager.MarkSceneDirty(scene);
        EditorSceneManager.SaveScene(scene, ScenePath);

        Debug.Log("[SlotScene] built " + ScenePath +
                  "\n  camera at " + camera.transform.position.ToString("F2") + " fov " + camera.fieldOfView +
                  "\n  machine at " + machine.transform.position.ToString("F2") +
                  "\n  controls: Space spins, R resets, clicking the cabinet spins, and the debug driver " +
                  "spins on a timer by default");
    }

    private static void BuildEnvironment()
    {
        // A flat dark ambient rather than a skybox: this is a television studio, not daylight.
        RenderSettings.skybox = null;
        RenderSettings.ambientMode = AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.055f, 0.055f, 0.065f);

        // The gold and the display glass need something to reflect or they read as flat paint. The
        // studio probe already in the project is exactly the right environment for this cabinet.
        var cubemap = AssetDatabase.LoadAssetAtPath<Cubemap>(ReflectionPath);
        if (cubemap != null)
        {
            RenderSettings.defaultReflectionMode = DefaultReflectionMode.Custom;
            RenderSettings.customReflectionTexture = cubemap;
            RenderSettings.reflectionIntensity = 0.55f;
        }
        else
        {
            Debug.LogWarning("[SlotScene] no reflection probe at " + ReflectionPath + "; the gold will read flat.");
        }
    }

    private static void BuildFloor()
    {
        var material = AssetDatabase.LoadAssetAtPath<Material>(FloorMaterialPath);
        if (material == null)
        {
            material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            material.SetColor("_BaseColor", new Color(0.16f, 0.16f, 0.17f));
            material.SetFloat("_Metallic", 0.05f);
            material.SetFloat("_Smoothness", 0.35f);
            AssetDatabase.CreateAsset(material, FloorMaterialPath);
        }

        var floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
        floor.name = "Floor";
        floor.transform.localScale = new Vector3(0.8f, 1f, 0.8f);   // Unity's plane is 10 m, so 8 m
        floor.GetComponent<MeshRenderer>().sharedMaterial = material;
        // Nothing is meant to be raycast except the cabinet, so the floor keeps no collider.
        Object.DestroyImmediate(floor.GetComponent<Collider>());
    }

    private static void BuildLights()
    {
        var root = new GameObject("Lights").transform;

        // Key from the front left, high enough to rake the gold trim.
        AddLight(root, "Key", new Vector3(-2.2f, 3.2f, 2.6f), new Vector3(38f, 148f, 0f),
            new Color(1f, 0.96f, 0.90f), 2.1f, LightShadows.Soft);

        // Fill from the front right, cool and dim, so the black side does not go to pure black.
        AddLight(root, "Fill", new Vector3(2.6f, 1.9f, 2.2f), new Vector3(16f, 218f, 0f),
            new Color(0.80f, 0.86f, 1f), 0.55f, LightShadows.None);

        // Warm rim from behind, which is what separates the cabinet from the floor.
        AddLight(root, "Rim", new Vector3(0.6f, 2.7f, -2.4f), new Vector3(28f, 8f, 0f),
            new Color(1f, 0.82f, 0.55f), 1.1f, LightShadows.None);
    }

    private static void AddLight(Transform parent, string name, Vector3 position, Vector3 euler, Color color, float intensity, LightShadows shadows)
    {
        var go = new GameObject(name);
        go.transform.SetParent(parent, false);
        go.transform.position = position;
        go.transform.rotation = Quaternion.Euler(euler);

        var light = go.AddComponent<Light>();
        light.type = LightType.Directional;
        light.color = color;
        light.intensity = intensity;
        light.shadows = shadows;
        light.shadowStrength = 0.7f;
    }

    private static Camera BuildCamera()
    {
        var go = new GameObject("Main Camera");
        go.tag = "MainCamera";
        // Head-on and eye height, far enough back that the whole 1.80 m cabinet fits with margin.
        go.transform.position = new Vector3(0f, 1.00f, 2.60f);
        go.transform.rotation = Quaternion.Euler(0f, 180f, 0f);

        var camera = go.AddComponent<Camera>();
        camera.fieldOfView = 45f;
        camera.nearClipPlane = 0.05f;
        camera.farClipPlane = 60f;
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color(0.035f, 0.035f, 0.045f);

        var urp = go.AddComponent<UniversalAdditionalCameraData>();
        urp.renderPostProcessing = true;
        urp.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;

        // Only here, and only so the cabinet can be clicked in the test scene. The show scene has no
        // raycaster, which is why nothing on the canvases is a raycast target.
        var raycaster = go.AddComponent<PhysicsRaycaster>();
        raycaster.eventMask = ~0;

        go.AddComponent<AudioListener>();
        return camera;
    }

    private static void BuildPostProcessing()
    {
        var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(ProfilePath);
        if (profile == null)
        {
            Debug.LogWarning("[SlotScene] no volume profile at " + ProfilePath + "; the scene runs without post processing.");
            return;
        }

        // The project's own profile, reused rather than replaced: its bloom is what makes the gold
        // glows and the win flash read as light rather than as pale sprites.
        var go = new GameObject("Global Volume");
        var volume = go.AddComponent<Volume>();
        volume.isGlobal = true;
        volume.priority = 0f;
        volume.sharedProfile = profile;
    }

    private static void BuildEventSystem()
    {
        var go = new GameObject("EventSystem");
        go.AddComponent<EventSystem>();
        // The project is set to the Input System package, so the old StandaloneInputModule would throw.
        go.AddComponent<InputSystemUIInputModule>();
    }

    private static void BuildDriver(GameObject machine)
    {
        var go = new GameObject("SlotMachineDebugDriver");
        var driver = go.AddComponent<SlotMachineDebugDriver>();

        var so = new SerializedObject(driver);
        so.FindProperty("controller").objectReferenceValue = machine.GetComponent<SlotMachineController>();
        so.FindProperty("autoSpin").boolValue = true;
        so.FindProperty("secondsBetweenSpins").floatValue = 1.2f;
        so.ApplyModifiedPropertiesWithoutUndo();
    }
}
