using System;
using UnityEngine;
using UnityEngine.InputSystem;

[RequireComponent(typeof(CharacterController))]
public class MovementController : MonoBehaviour
{
    private CharacterController m_CharacterController;
    
    private void Awake()
    {
        this.m_CharacterController = GetComponent<CharacterController>();
    }

    void Update()
    {
        var kb = Keyboard.current;
        if (kb == null)
        {
            return;
        }
        
        float x = kb.dKey.isPressed ? 1 : 0;
        x = kb.aKey.isPressed ? -1 : x;

        float z = kb.wKey.isPressed ? 1 : 0;
        z = kb.sKey.isPressed ? -1 : z;

        float moveSpeed = 10f;
        Vector3 move = transform.right * x + transform.forward * z;
        m_CharacterController.Move(move * (moveSpeed * Time.deltaTime));
    }
}