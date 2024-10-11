class Apple:
    def __init__(self, color="red", size="medium"):
        self.color = color
        self.size = size

    def describe(self):
        return f"This is a {self.size} {self.color} apple."

# Create an instance of Apple
my_apple = Apple()
print(my_apple.describe())


def add_apples(apple1, apple2):
    """
    Adds two Apple objects together.
    This function doesn't actually combine the apples, but rather
    returns a new Apple object with combined characteristics.
    """
    new_color = f"{apple1.color}-{apple2.color}"
    new_size = "large" if apple1.size == "medium" and apple2.size == "medium" else "extra large"
    return Apple(color=new_color, size=new_size)

# Example usage:
apple1 = Apple(color="red", size="medium")
apple2 = Apple(color="green", size="medium")
combined_apple = add_apples(apple1, apple2)
print(combined_apple.describe())

