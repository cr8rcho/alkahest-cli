import 'package:flutter/material.dart';
import 'details_page.dart';

class HomePage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          TextField(),
          ElevatedButton(
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => DetailsPage()),
              );
            },
            child: Text('Details'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pushNamed(context, '/settings'),
            child: Text('Settings'),
          ),
        ],
      ),
    );
  }
}
