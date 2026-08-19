using UnityEngine;
using UnityEngine.EventSystems;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

/// <summary>
/// Every way a spin can be asked for, in one place. <see cref="SlotMachineController"/> reads no
/// device of its own, so what starts a spin can change without the rules changing.
///
/// Three routes in:
/// <list type="bullet">
/// <item><see cref="RequestSpin"/>, which a UI button, a physical button relay or the show's own
/// director calls.</item>
/// <item>A click or tap on the cabinet, if <see cref="clickToSpin"/> is on and the collider is set
/// up for it.</item>
/// <item>A key, in the editor and development builds only, so a shipped show cannot be spun from a
/// stray keyboard in the studio.</item>
/// </list>
/// </summary>
[DisallowMultipleComponent]
public class SlotMachineInput : MonoBehaviour, IPointerClickHandler
{
    [Tooltip("The machine to spin. Left empty, it is looked up on this object and its parents.")]
    [SerializeField] private SlotMachineController controller;

    [Tooltip("Spin when the cabinet's interaction collider is clicked. Needs a Physics Raycaster " +
             "on the camera and an EventSystem in the scene.")]
    [SerializeField] private bool clickToSpin = true;

    [Header("Editor and development builds only")]
    [Tooltip("Allow a key to start a spin. Compiled out of a release build either way.")]
    [SerializeField] private bool keyboardTestSpin = true;

#if ENABLE_INPUT_SYSTEM
    [Tooltip("Key that starts a spin while testing.")]
    [SerializeField] private Key testSpinKey = Key.Space;

    [Tooltip("Key that resets the machine while testing.")]
    [SerializeField] private Key testResetKey = Key.R;
#endif

    private void Awake()
    {
        if (controller == null)
        {
            controller = GetComponentInParent<SlotMachineController>();
        }

        if (controller == null)
        {
            Debug.LogWarning("[Slot] SlotMachineInput on " + name + " found no controller, so nothing can spin it.", this);
        }
    }

    /// <summary>Asks for a spin. Ignored when the machine is busy; it decides, not this.</summary>
    public void RequestSpin()
    {
        if (controller != null)
        {
            controller.Spin();
        }
    }

    /// <summary>Asks for a spin onto a known result, for a show that already has one.</summary>
    public void RequestSpinWithResult(SlotMachineResult result)
    {
        if (controller != null)
        {
            controller.SpinWithResult(result);
        }
    }

    /// <summary>Puts the machine back to idle, whatever it was doing.</summary>
    public void RequestReset()
    {
        if (controller != null)
        {
            controller.ResetMachine();
        }
    }

    /// <summary>
    /// Reached when a Physics Raycaster on the camera hits the cabinet's interaction collider. Does
    /// nothing at all unless the scene has both an EventSystem and that raycaster, which the test
    /// scene sets up and the show scene deliberately does not.
    /// </summary>
    public void OnPointerClick(PointerEventData eventData)
    {
        if (clickToSpin)
        {
            RequestSpin();
        }
    }

    /// <summary>The same thing, in the shape an EventTrigger entry can call.</summary>
    public void OnPointerClickEvent(BaseEventData eventData)
    {
        if (clickToSpin)
        {
            RequestSpin();
        }
    }

#if UNITY_EDITOR || DEVELOPMENT_BUILD
    private void Update()
    {
        if (!keyboardTestSpin)
        {
            return;
        }

#if ENABLE_INPUT_SYSTEM
        var keyboard = Keyboard.current;
        if (keyboard == null)
        {
            return;
        }

        if (keyboard[testSpinKey].wasPressedThisFrame)
        {
            RequestSpin();
        }

        if (keyboard[testResetKey].wasPressedThisFrame)
        {
            RequestReset();
        }
#else
        // No Input System package: fall back to the old manager so the test key still works.
        if (Input.GetKeyDown(KeyCode.Space))
        {
            RequestSpin();
        }

        if (Input.GetKeyDown(KeyCode.R))
        {
            RequestReset();
        }
#endif
    }
#endif
}
