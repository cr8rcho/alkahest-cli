// Minimal Compose project marker (detect reads androidx.compose / navigation.compose imports in .kt).
plugins {
    id("org.jetbrains.kotlin.plugin.compose")
}

dependencies {
    implementation("androidx.compose.ui:ui:1.6.0")
    implementation("androidx.navigation:navigation-compose:2.7.0")
}
