import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class DetailsPage extends StatelessWidget {
  Future<void> loadData() async {
    final response = await http.get(Uri.parse('https://api.example.com/items'));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: ListView(
        children: [
          ElevatedButton(
            onPressed: () => Navigator.pushNamed(context, '/'),
            child: Text('Home'),
          ),
        ],
      ),
    );
  }
}
