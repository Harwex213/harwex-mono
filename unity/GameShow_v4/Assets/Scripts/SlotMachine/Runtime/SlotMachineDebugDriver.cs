using System.Collections;
using UnityEngine;

/// <summary>
/// Drives the machine on its own in the test scene, so a full cycle can be watched without anyone
/// pressing anything. It only ever calls the public API, so what it exercises is exactly what a show
/// would.
///
/// It also writes each event to the console, which is what makes a play-mode run readable after the
/// fact: one line per spin start, per reel landing and per result.
/// </summary>
[DisallowMultipleComponent]
public class SlotMachineDebugDriver : MonoBehaviour
{
    [Tooltip("The machine to drive. Left empty, it is looked up in the scene.")]
    [SerializeField] private SlotMachineController controller;

    [Tooltip("Keep spinning on a timer. Off leaves the machine to the keyboard or a button.")]
    [SerializeField] private bool autoSpin = true;

    [Tooltip("Seconds after the machine returns to idle before the next spin.")]
    [SerializeField, Min(0f)] private float secondsBetweenSpins = 1.2f;

    [Tooltip("Spins to run before stopping. 0 runs for ever.")]
    [SerializeField, Min(0)] private int spinLimit;

    [Tooltip("Force a specific line instead of drawing one. The three indices are strip positions.")]
    [SerializeField] private bool forceResult;

    [SerializeField] private int[] forcedIndices = new int[SlotMachineResult.ReelCount];

    private int _spins;
    private Coroutine _loop;

    private void Awake()
    {
        if (controller == null)
        {
            controller = FindAnyObjectByType<SlotMachineController>();
        }
    }

    private void OnEnable()
    {
        if (controller == null)
        {
            Debug.LogWarning("[SlotDebug] no SlotMachineController in the scene.", this);
            return;
        }

        controller.SpinStarted += OnSpinStarted;
        controller.ReelStopped += OnReelStopped;
        controller.SpinCompleted += OnSpinCompleted;
        controller.WinStarted += OnWinStarted;
        controller.ReturnedToIdle += OnReturnedToIdle;

        if (autoSpin)
        {
            _loop = StartCoroutine(AutoSpin());
        }
    }

    private void OnDisable()
    {
        if (controller == null)
        {
            return;
        }

        controller.SpinStarted -= OnSpinStarted;
        controller.ReelStopped -= OnReelStopped;
        controller.SpinCompleted -= OnSpinCompleted;
        controller.WinStarted -= OnWinStarted;
        controller.ReturnedToIdle -= OnReturnedToIdle;

        if (_loop != null)
        {
            StopCoroutine(_loop);
            _loop = null;
        }
    }

    /// <summary>Starts one spin now, forced or drawn depending on the settings above.</summary>
    public void SpinOnce()
    {
        if (controller == null)
        {
            return;
        }

        if (forceResult)
        {
            controller.SpinWithResult(SlotMachineResult.FromIndices(
                Index(0), Index(1), Index(2)));
        }
        else
        {
            controller.Spin();
        }
    }

    private int Index(int reel)
    {
        return forcedIndices != null && reel < forcedIndices.Length ? forcedIndices[reel] : 0;
    }

    private IEnumerator AutoSpin()
    {
        while (spinLimit == 0 || _spins < spinLimit)
        {
            while (!controller.CanSpin)
            {
                yield return null;
            }

            yield return new WaitForSeconds(secondsBetweenSpins);

            if (!controller.CanSpin)
            {
                continue;
            }

            _spins++;
            SpinOnce();

            // Wait for the machine to leave Idle before waiting for it to come back, or this would
            // count the same idle twice and fire two spins in a row.
            while (controller.State == SlotMachineState.Idle)
            {
                yield return null;
            }
        }

        Debug.Log("[SlotDebug] finished " + _spins + " spins.", this);
        _loop = null;
    }

    private void OnSpinStarted()
    {
        Debug.Log("[SlotDebug] spin " + _spins + " started", this);
    }

    private void OnReelStopped(int reel)
    {
        var reels = controller.GetComponent<SlotMachineView>().Reels;
        var item = reel < reels.Length && reels[reel] != null ? reels[reel].WinLineItem : null;
        Debug.Log("[SlotDebug] reel " + reel + " landed on " + (item == null ? "?" : item.ToString()), this);
    }

    private void OnWinStarted(SlotMachineResult result)
    {
        Debug.Log("[SlotDebug] WIN " + result, this);
    }

    private void OnSpinCompleted(SlotMachineResult result)
    {
        Debug.Log("[SlotDebug] completed " + result, this);
    }

    private void OnReturnedToIdle()
    {
        Debug.Log("[SlotDebug] idle again", this);
    }
}
