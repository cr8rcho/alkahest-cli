package com.example

import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.navigation.NavController

@Composable
fun HomeScreen(navController: NavController) {
    OutlinedTextField(value = "", onValueChange = {})
    Button(onClick = { navController.navigate("details") }) {
        Text("Go to details")
    }
    Button(onClick = { navController.navigate("profile") }) {
        Text("Profile")
    }
}
