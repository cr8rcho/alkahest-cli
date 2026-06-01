import 'package:flutter/material.dart';
import 'home_page.dart';
import 'details_page.dart';
import 'settings_page.dart';

void main() {
  runApp(MyApp());
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      initialRoute: '/',
      routes: {
        '/': (context) => HomePage(),
        '/details': (context) => DetailsPage(),
        '/settings': (context) => SettingsPage(),
      },
    );
  }
}
