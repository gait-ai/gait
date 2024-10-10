class Apple:
    def __init__(self, color="red", size="medium"):
        self.color = color
        self.size = size

    def describe(self):
        return f"This is a {self.size} {self.color} apple."

# Create an instance of Apple
my_apple = Apple()
print(my_apple.describe())
