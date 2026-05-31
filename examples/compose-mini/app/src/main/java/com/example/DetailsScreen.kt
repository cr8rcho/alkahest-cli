package com.example

import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.navigation.NavController

@Composable
fun DetailsScreen(navController: NavController) {
    LazyColumn {}
    val client = HttpClient()
    client.get("https://api.example.com/items")
    Button(onClick = { navController.navigate("home") }) {
        Text("Back home")
    }
}
