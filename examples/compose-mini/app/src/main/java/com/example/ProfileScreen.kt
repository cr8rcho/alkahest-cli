package com.example

import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun ProfileScreen() {
    Switch(checked = true, onCheckedChange = {})
    Text("Profile")
}
