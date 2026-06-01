import 'package:flutter/material.dart';

class SettingsPage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Switch(value: true, onChanged: (_) {}),
          ElevatedButton(
            onPressed: () => Navigator.pushNamed(context, '/details'),
            child: Text('Details'),
          ),
        ],
      ),
    );
  }
}
